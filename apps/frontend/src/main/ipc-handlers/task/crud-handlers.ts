import { ipcMain } from 'electron';
import { IPC_CHANNELS, AUTO_BUILD_PATHS, getSpecsDir, DEFAULT_AUTO_BUILD_PATH } from '../../../shared/constants';
import type { IPCResult, Task, TaskMetadata, ModelRoutingSettings, Project, IntakeResult } from '../../../shared/types';
import path from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'fs';
import { projectStore } from '../../project-store';
import { titleGenerator } from '../../title-generator';
import { AgentManager } from '../../agent';
import { findTaskAndProject } from './shared';
import { initializeGit, initializeProject, copyProjectSnapshot } from '../../project-initializer';
import { createSandboxProjectDirectory } from '../../sandbox-manager';
import { sandboxRegistry } from '../../sandbox-registry';

const getFallbackTitle = (description: string): string => {
  const firstLine = description.split('\n').find(line => line.trim()) || '';
  const trimmed = firstLine.trim();
  if (!trimmed) {
    return 'Untitled task';
  }
  const truncated = trimmed.substring(0, 60);
  return trimmed.length > 60 ? `${truncated}...` : truncated;
};

const resolveTaskTitle = async (
  title: string,
  description: string,
  logLabel: string
): Promise<string> => {
  if (title?.trim()) {
    return title.trim();
  }

  console.warn(`[${logLabel}] Title is empty, generating with Claude AI...`);
  try {
    const generatedTitle = await titleGenerator.generateTitle(description);
    if (generatedTitle) {
      console.warn(`[${logLabel}] Generated title:`, generatedTitle);
      return generatedTitle;
    }
    const fallback = getFallbackTitle(description);
    console.warn(`[${logLabel}] AI generation failed, using fallback:`, fallback);
    return fallback;
  } catch (err) {
    console.error(`[${logLabel}] Title generation error:`, err);
    return getFallbackTitle(description);
  }
};

const logSandbox = (message: string, details?: Record<string, unknown>): void => {
  if (details) {
    console.info('[Sandbox]', message, details);
    return;
  }
  console.info('[Sandbox]', message);
};

const serializeIntakeResult = (intake?: IntakeResult): Record<string, unknown> | undefined => {
  if (!intake) return undefined;
  return {
    clarity_level: intake.clarityLevel,
    clarifying_questions: intake.clarifyingQuestions,
    suggested_title: intake.suggestedTitle,
    risks: intake.risks,
    assumptions: intake.assumptions,
    notes: intake.notes,
    intake_model: intake.intakeModel
  };
};

const SANDBOX_DATA_ENTRIES = [
  DEFAULT_AUTO_BUILD_PATH,
  '.auto-iflow-security.json',
  '.auto-iflow-allowlist',
  '.auto-iflow-status',
  '.claude_settings.json',
  '.security-key',
  path.join('logs', 'security')
];

const cleanupSandboxData = (sandboxPath: string): void => {
  for (const entry of SANDBOX_DATA_ENTRIES) {
    const targetPath = path.join(sandboxPath, entry);
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }
  }
};

export const createTaskInProject = (
  project: Project,
  title: string,
  description: string,
  metadata?: TaskMetadata
): Task => {
  // Generate a unique spec ID based on existing specs
  const specsBaseDir = getSpecsDir(project.autoBuildPath);
  const specsDir = path.join(project.path, specsBaseDir);

  // Find next available spec number
  let specNumber = 1;
  if (existsSync(specsDir)) {
    const existingDirs = readdirSync(specsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    // Extract numbers from spec directory names (e.g., "001-feature" -> 1)
    const existingNumbers = existingDirs
      .map(name => {
        const match = name.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);

    if (existingNumbers.length > 0) {
      specNumber = Math.max(...existingNumbers) + 1;
    }
  }

  // Create spec ID with zero-padded number and slugified title
  const slugifiedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  const specId = `${String(specNumber).padStart(3, '0')}-${slugifiedTitle || 'task'}`;

  // Create spec directory
  const specDir = path.join(specsDir, specId);
  mkdirSync(specDir, { recursive: true });

  // Build metadata with source type
  const taskMetadata: TaskMetadata = {
    sourceType: 'manual',
    ...metadata
  };

  // Process and save attached images
  if (taskMetadata.attachedImages && taskMetadata.attachedImages.length > 0) {
    const attachmentsDir = path.join(specDir, 'attachments');
    mkdirSync(attachmentsDir, { recursive: true });

    const savedImages: typeof taskMetadata.attachedImages = [];

    for (const image of taskMetadata.attachedImages) {
      if (image.data) {
        try {
          // Decode base64 and save to file
          const buffer = Buffer.from(image.data, 'base64');
          const imagePath = path.join(attachmentsDir, image.filename);
          writeFileSync(imagePath, buffer);

          // Store relative path instead of base64 data
          savedImages.push({
            id: image.id,
            filename: image.filename,
            mimeType: image.mimeType,
            size: image.size,
            path: `attachments/${image.filename}`
            // Don't include data or thumbnail to save space
          });
        } catch (err) {
          console.error(`Failed to save image ${image.filename}:`, err);
        }
      }
    }

    // Update metadata with saved image paths (without base64 data)
    taskMetadata.attachedImages = savedImages;
  }

  // Create initial implementation_plan.json (task is created but not started)
  const now = new Date().toISOString();
  const implementationPlan = {
    feature: title,
    description: description,
    created_at: now,
    updated_at: now,
    status: 'pending',
    phases: []
  };

  const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
  writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2));

  // Save task metadata if provided
  if (taskMetadata) {
    const metadataPath = path.join(specDir, 'task_metadata.json');
    writeFileSync(metadataPath, JSON.stringify(taskMetadata, null, 2));
  }

  // Create requirements.json with attached images
  const requirements: Record<string, unknown> = {
    task_description: description,
    workflow_type: taskMetadata.category || 'feature'
  };

  const intakePayload = serializeIntakeResult(taskMetadata.intakeResult);
  if (intakePayload) {
    requirements.intake = intakePayload;
  }

  // Add attached images to requirements if present
  if (taskMetadata.attachedImages && taskMetadata.attachedImages.length > 0) {
    requirements.attached_images = taskMetadata.attachedImages.map(img => ({
      filename: img.filename,
      path: img.path,
      description: '' // User can add descriptions later
    }));
  }

  const requirementsPath = path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS);
  writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2));

  // Create the task object
  const task: Task = {
    id: specId,
    specId: specId,
    projectId: project.id,
    title: title,
    description,
    status: 'backlog',
    subtasks: [],
    logs: [],
    metadata: taskMetadata,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Invalidate cache since a new task was created
  projectStore.invalidateTasksCache(project.id);

  return task;
};

/**
 * Register task CRUD (Create, Read, Update, Delete) handlers
 */
export function registerTaskCRUDHandlers(agentManager: AgentManager): void {
  /**
   * List all tasks for a project
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LIST,
    async (_, projectId: string): Promise<IPCResult<Task[]>> => {
      console.warn('[IPC] TASK_LIST called with projectId:', projectId);
      const tasks = projectStore.getTasks(projectId);
      console.warn('[IPC] TASK_LIST returning', tasks.length, 'tasks');
      return { success: true, data: tasks };
    }
  );

  /**
   * Create a new task
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_CREATE,
    async (
      _,
      projectId: string,
      title: string,
      description: string,
      metadata?: TaskMetadata
    ): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const finalTitle = await resolveTaskTitle(title, description, 'TASK_CREATE');
      const task = createTaskInProject(project, finalTitle, description, metadata);
      return { success: true, data: task };
    }
  );

  /**
   * Create a new task in a sandbox project
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_CREATE_SANDBOX,
    async (
      _,
      title: string,
      description: string,
      metadata?: TaskMetadata,
      sourceProjectId?: string
    ): Promise<IPCResult<{ task: Task; project: Project }>> => {
      let sandboxPath: string | null = null;

      try {
        logSandbox('Create request received', {
          hasTitle: Boolean(title?.trim()),
          descriptionLength: description?.trim().length || 0
        });
        const finalTitle = await resolveTaskTitle(title, description, 'TASK_CREATE_SANDBOX');
        const projectName = finalTitle || 'Sandbox Task';
        logSandbox('Resolved sandbox title', { title: finalTitle || 'Sandbox Task' });

        const sandboxDir = createSandboxProjectDirectory(projectName);
        sandboxPath = sandboxDir.path;
        logSandbox('Created sandbox directory', { path: sandboxPath });

        if (sourceProjectId) {
          const sourceProject = projectStore.getProject(sourceProjectId);
          const sourcePath = sourceProject?.path;
          if (!sourcePath) {
            throw new Error(`Source project not found: ${sourceProjectId}`);
          }

          logSandbox('Copying source project into sandbox', {
            sourceProjectId,
            sourcePath
          });
          const copyResult = copyProjectSnapshot(sourcePath, sandboxPath);
          if (!copyResult.success) {
            throw new Error(copyResult.error || 'Failed to copy source project into sandbox');
          }
          logSandbox('Source project copied into sandbox', { sourcePath });

          logSandbox('Cleaning sandbox data directories');
          cleanupSandboxData(sandboxPath);
          logSandbox('Sandbox data directories cleaned');
        } else {
          logSandbox('No source project provided for sandbox; initializing empty repo');
        }

        const gitInitResult = initializeGit(sandboxPath);
        if (!gitInitResult.success) {
          throw new Error(gitInitResult.error || 'Failed to initialize sandbox git repository');
        }
        logSandbox('Initialized sandbox git repository');

        const initResult = initializeProject(sandboxPath);
        if (!initResult.success) {
          throw new Error(initResult.error || 'Failed to initialize sandbox project');
        }
        logSandbox('Initialized sandbox project');

        const finalizeGitResult = initializeGit(sandboxPath);
        if (!finalizeGitResult.success) {
          throw new Error(finalizeGitResult.error || 'Failed to finalize sandbox git repository');
        }
        logSandbox('Finalized sandbox git repository');

        const project = projectStore.addProject(sandboxPath, projectName, { isSandbox: true });
        const task = createTaskInProject(project, finalTitle, description, {
          ...metadata,
          sandbox: true
        });
        logSandbox('Sandbox project added to store', { projectId: project.id });
        logSandbox('Sandbox task created', { taskId: task.id, specId: task.specId });

        sandboxRegistry.upsert({
          taskId: task.id,
          projectId: project.id,
          projectPath: project.path,
          createdAt: new Date().toISOString()
        });
        logSandbox('Sandbox registry updated', { taskId: task.id, projectId: project.id });

        logSandbox('Sandbox create completed', { projectId: project.id, taskId: task.id });
        return { success: true, data: { task, project } };
      } catch (error) {
        logSandbox('Sandbox create failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        if (sandboxPath && existsSync(sandboxPath)) {
          rmSync(sandboxPath, { recursive: true, force: true });
          logSandbox('Sandbox cleanup completed', { path: sandboxPath });
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create sandbox task'
        };
      }
    }
  );

  /**
   * Delete a task
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_DELETE,
    async (_, taskId: string): Promise<IPCResult<{ removedProjectId?: string }>> => {
      const { rm } = await import('fs/promises');

      // Find task and project
      const { task, project } = findTaskAndProject(taskId);

      if (!task || !project) {
        return { success: false, error: 'Task or project not found' };
      }

      // Check if task is currently running
      const isRunning = agentManager.isRunning(taskId);
      if (isRunning) {
        return { success: false, error: 'Cannot delete a running task. Stop the task first.' };
      }

      const isSandboxTask = Boolean(
        project.isSandbox ||
        task.metadata?.sandbox ||
        sandboxRegistry.getByProjectId(project.id)
      );
      if (isSandboxTask) {
        try {
          logSandbox('Sandbox delete requested', { taskId: task.id, projectId: project.id });
          if (existsSync(project.path)) {
            await rm(project.path, { recursive: true, force: true });
            logSandbox('Sandbox directory removed', { path: project.path });
          }

          projectStore.removeProject(project.id);
          sandboxRegistry.removeByProjectId(project.id);
          logSandbox('Sandbox project removed from store', { projectId: project.id });
          logSandbox('Sandbox registry entry removed', { projectId: project.id });

          return { success: true, data: { removedProjectId: project.id } };
        } catch (error) {
          logSandbox('Sandbox delete failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
            projectId: project.id
          });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete sandbox project'
          };
        }
      }

      // Delete the spec directory - use task.specsPath if available (handles worktree tasks)
      const specDir = task.specsPath || path.join(project.path, getSpecsDir(project.autoBuildPath), task.specId);

      try {
        console.warn(`[TASK_DELETE] Attempting to delete: ${specDir} (location: ${task.location || 'unknown'})`);
        if (existsSync(specDir)) {
          await rm(specDir, { recursive: true, force: true });
          console.warn(`[TASK_DELETE] Deleted spec directory: ${specDir}`);
        } else {
          console.warn(`[TASK_DELETE] Spec directory not found: ${specDir}`);
        }

        // Invalidate cache since a task was deleted
        projectStore.invalidateTasksCache(project.id);

        return { success: true };
      } catch (error) {
        console.error('[TASK_DELETE] Error deleting spec directory:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete task files'
        };
      }
    }
  );

  /**
   * Update a task
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_UPDATE,
    async (
      _,
      taskId: string,
      updates: { title?: string; description?: string; metadata?: Partial<TaskMetadata> }
    ): Promise<IPCResult<Task>> => {
      try {
        // Find task and project
        const { task, project } = findTaskAndProject(taskId);

        if (!task || !project) {
          return { success: false, error: 'Task not found' };
        }

        const autoBuildDir = project.autoBuildPath || DEFAULT_AUTO_BUILD_PATH;
        const specDir = path.join(project.path, autoBuildDir, 'specs', task.specId);

        if (!existsSync(specDir)) {
          return { success: false, error: 'Spec directory not found' };
        }

        // Auto-generate title if empty
        let finalTitle = updates.title;
        if (updates.title !== undefined && !updates.title.trim()) {
          // Get description to use for title generation
          const descriptionToUse = updates.description ?? task.description;
          console.warn('[TASK_UPDATE] Title is empty, generating with Claude AI...');
          try {
            const generatedTitle = await titleGenerator.generateTitle(descriptionToUse);
            if (generatedTitle) {
              finalTitle = generatedTitle;
              console.warn('[TASK_UPDATE] Generated title:', finalTitle);
            } else {
              // Fallback: create title from first line of description
              finalTitle = descriptionToUse.split('\n')[0].substring(0, 60);
              if (finalTitle.length === 60) finalTitle += '...';
              console.warn('[TASK_UPDATE] AI generation failed, using fallback:', finalTitle);
            }
          } catch (err) {
            console.error('[TASK_UPDATE] Title generation error:', err);
            // Fallback: create title from first line of description
            finalTitle = descriptionToUse.split('\n')[0].substring(0, 60);
            if (finalTitle.length === 60) finalTitle += '...';
          }
        }

        // Update implementation_plan.json
        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        if (existsSync(planPath)) {
          try {
            const planContent = readFileSync(planPath, 'utf-8');
            const plan = JSON.parse(planContent);

            if (finalTitle !== undefined) {
              plan.feature = finalTitle;
            }
            if (updates.description !== undefined) {
              plan.description = updates.description;
            }
            plan.updated_at = new Date().toISOString();

            writeFileSync(planPath, JSON.stringify(plan, null, 2));
          } catch {
            // Plan file might not be valid JSON, continue anyway
          }
        }

        // Update spec.md if it exists
        const specPath = path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE);
        if (existsSync(specPath)) {
          try {
            let specContent = readFileSync(specPath, 'utf-8');

            // Update title (first # heading)
            if (finalTitle !== undefined) {
              specContent = specContent.replace(
                /^#\s+.*$/m,
                `# ${finalTitle}`
              );
            }

            // Update description (## Overview section content)
            if (updates.description !== undefined) {
              // Replace content between ## Overview and the next ## section
              specContent = specContent.replace(
                /(## Overview\n)([\s\S]*?)((?=\n## )|$)/,
                `$1${updates.description}\n\n$3`
              );
            }

            writeFileSync(specPath, specContent);
          } catch {
            // Spec file update failed, continue anyway
          }
        }

        // Update metadata if provided
        let updatedMetadata = task.metadata;
        if (updates.metadata) {
          updatedMetadata = { ...task.metadata, ...updates.metadata };

          // Process and save attached images if provided
          if (updates.metadata.attachedImages && updates.metadata.attachedImages.length > 0) {
            const attachmentsDir = path.join(specDir, 'attachments');
            mkdirSync(attachmentsDir, { recursive: true });

            const savedImages: typeof updates.metadata.attachedImages = [];

            for (const image of updates.metadata.attachedImages) {
              // If image has data (new image), save it
              if (image.data) {
                try {
                  const buffer = Buffer.from(image.data, 'base64');
                  const imagePath = path.join(attachmentsDir, image.filename);
                  writeFileSync(imagePath, buffer);

                  savedImages.push({
                    id: image.id,
                    filename: image.filename,
                    mimeType: image.mimeType,
                    size: image.size,
                    path: `attachments/${image.filename}`
                  });
                } catch (err) {
                  console.error(`Failed to save image ${image.filename}:`, err);
                }
              } else if (image.path) {
                // Existing image, keep it
                savedImages.push(image);
              }
            }

            updatedMetadata.attachedImages = savedImages;
          }

          // Update task_metadata.json
          const metadataPath = path.join(specDir, 'task_metadata.json');
          try {
            writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2));
          } catch (err) {
            console.error('Failed to update task_metadata.json:', err);
          }

          // Update requirements.json if it exists
          const requirementsPath = path.join(specDir, 'requirements.json');
          if (existsSync(requirementsPath)) {
            try {
              const requirementsContent = readFileSync(requirementsPath, 'utf-8');
              const requirements = JSON.parse(requirementsContent);

              if (updates.description !== undefined) {
                requirements.task_description = updates.description;
              }
              if (updates.metadata.category) {
                requirements.workflow_type = updates.metadata.category;
              }

              writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2));
            } catch (err) {
              console.error('Failed to update requirements.json:', err);
            }
          }
        }

        // Build the updated task object
        const updatedTask: Task = {
          ...task,
          title: finalTitle ?? task.title,
          description: updates.description ?? task.description,
          metadata: updatedMetadata,
          updatedAt: new Date()
        };

        // Invalidate cache since a task was updated
        projectStore.invalidateTasksCache(project.id);

        return { success: true, data: updatedTask };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_MODEL_ROUTING_GET,
    async (_, taskId: string): Promise<IPCResult<ModelRoutingSettings | null>> => {
      const { task, project } = findTaskAndProject(taskId);
      if (!task || !project) {
        return { success: false, error: 'Task not found' };
      }

      const autoBuildDir = project.autoBuildPath || DEFAULT_AUTO_BUILD_PATH;
      const specDir = path.join(project.path, autoBuildDir, 'specs', task.specId);
      if (!existsSync(specDir)) {
        return { success: false, error: 'Spec directory not found' };
      }

      const metadataPath = path.join(specDir, 'task_metadata.json');
      let metadata: TaskMetadata | undefined = task.metadata;

      if (existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) as TaskMetadata;
        } catch {
          // Fall back to in-memory metadata
        }
      }

      return { success: true, data: metadata?.modelRouting ?? null };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_MODEL_ROUTING_SET,
    async (
      _,
      taskId: string,
      modelRouting: ModelRoutingSettings
    ): Promise<IPCResult> => {
      const { task, project } = findTaskAndProject(taskId);
      if (!task || !project) {
        return { success: false, error: 'Task not found' };
      }

      const autoBuildDir = project.autoBuildPath || DEFAULT_AUTO_BUILD_PATH;
      const specDir = path.join(project.path, autoBuildDir, 'specs', task.specId);
      if (!existsSync(specDir)) {
        return { success: false, error: 'Spec directory not found' };
      }

      const metadataPath = path.join(specDir, 'task_metadata.json');
      let metadata: TaskMetadata = task.metadata ?? ({} as TaskMetadata);

      if (existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) as TaskMetadata;
        } catch {
          // Keep best-effort metadata
        }
      }

      const updated: TaskMetadata = {
        ...metadata,
        modelRouting,
      };

      try {
        writeFileSync(metadataPath, JSON.stringify(updated, null, 2));
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update task metadata'
        };
      }

      projectStore.invalidateTasksCache(project.id);

      return { success: true };
    }
  );
}
