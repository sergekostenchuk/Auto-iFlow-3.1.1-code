import { useState, useEffect, useCallback, useRef, useMemo, type ClipboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronDown, ChevronUp, Image as ImageIcon, X, RotateCcw, FolderTree, GitBranch } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import {
  generateImageId,
  blobToBase64,
  createThumbnail,
  isValidImageMimeType,
  resolveFilename
} from './ImageUpload';
import { TaskFileExplorerDrawer } from './TaskFileExplorerDrawer';
import { AgentProfileSelector } from './AgentProfileSelector';
import { FileAutocomplete } from './FileAutocomplete';
import { ClarifyTaskDialog } from './ClarifyTaskDialog';
import { IntakeProgressIndicator } from './IntakeProgressIndicator';
import { createTask, createSandboxTask, saveDraft, loadDraft, clearDraft, isDraftEmpty } from '../stores/task-store';
import { saveIntakeDraft, loadIntakeDraft, clearIntakeDraft } from '../stores/intake-store';
import { loadInsightsSession, sendMessage } from '../stores/insights-store';
import { useProjectStore } from '../stores/project-store';
import { cn } from '../lib/utils';
import type {
  TaskCategory,
  TaskPriority,
  TaskComplexity,
  TaskImpact,
  TaskMetadata,
  ImageAttachment,
  TaskDraft,
  ModelType,
  ThinkingLevel,
  ReferencedFile,
  IntakeResult,
  ClarifyingQuestion,
  ClarifyAnswers
} from '../../shared/types';
import type { PhaseModelConfig, PhaseThinkingConfig } from '../../shared/types/settings';
import {
  TASK_CATEGORY_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_COMPLEXITY_LABELS,
  TASK_IMPACT_LABELS,
  MAX_IMAGES_PER_TASK,
  ALLOWED_IMAGE_TYPES_DISPLAY,
  DEFAULT_AGENT_PROFILES,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
  DEFAULT_MODEL_ROUTING
} from '../../shared/constants';
import { useSettingsStore } from '../stores/settings-store';
import { normalizeRouting, mergeRoutingWithFallback } from './model-routing/model-routing-utils';
import { useModelRegistry } from './model-routing/useModelRegistry';

const SANDBOX_DRAFT_PROJECT_ID = '__sandbox__';

interface TaskCreationWizardProps {
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenInsights?: () => void;
}

export const extractBlockerAction = (blocker: string): string => {
  const normalized = blocker.trim().toLowerCase();
  const cannotMatch = normalized.match(/cannot\s+(.+)/i);
  const action = cannotMatch?.[1] ?? normalized;
  return action.replace(/[.]+$/, '').trim();
};

export const createBlockerSignature = (blockers: string[]): string =>
  blockers
    .map(extractBlockerAction)
    .filter((value) => value.length > 0)
    .sort()
    .join('|');

export function TaskCreationWizard({
  projectId,
  open,
  onOpenChange,
  onOpenInsights
}: TaskCreationWizardProps) {
  const { t } = useTranslation('tasks');
  // Get selected agent profile from settings
  const { settings } = useSettingsStore();
  const sandboxTasksEnabled = settings.sandboxTasksEnabled ?? false;
  const hasProject = Boolean(projectId);
  const forceSandbox = sandboxTasksEnabled && !hasProject;
  const draftProjectId = projectId ?? SANDBOX_DRAFT_PROJECT_ID;
  const selectedProfile = DEFAULT_AGENT_PROFILES.find(
    p => p.id === settings.selectedAgentProfile
  ) || DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto')!;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [showGitOptions, setShowGitOptions] = useState(false);
  const [useSandbox, setUseSandbox] = useState(false);

  // Git options state
  // Use a special value to represent "use project default" since Radix UI Select doesn't allow empty string values
  const PROJECT_DEFAULT_BRANCH = '__project_default__';
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string>(PROJECT_DEFAULT_BRANCH);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('');
  // Worktree isolation - default to true for safety
  const [useWorktree, setUseWorktree] = useState(true);

  // Get project path from project store
  const projects = useProjectStore((state) => state.projects);
  const addProjectToStore = useProjectStore((state) => state.addProject);
  const openProjectTab = useProjectStore((state) => state.openProjectTab);
  const projectPath = useMemo(() => {
    const project = projects.find((p) => p.id === projectId);
    return project?.path ?? null;
  }, [projects, projectId]);

  // Metadata fields
  const [category, setCategory] = useState<TaskCategory | ''>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [complexity, setComplexity] = useState<TaskComplexity | ''>('');
  const [impact, setImpact] = useState<TaskImpact | ''>('');

  // Model configuration (initialized from selected agent profile)
  const [profileId, setProfileId] = useState<string>(settings.selectedAgentProfile || 'auto');
  const [model, setModel] = useState<ModelType | ''>(selectedProfile.model);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | ''>(selectedProfile.thinkingLevel);
  // Auto profile - per-phase configuration
  // Use custom settings from app settings if available, otherwise fall back to defaults
  const [phaseModels, setPhaseModels] = useState<PhaseModelConfig | undefined>(
    settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS
  );
  const [phaseThinking, setPhaseThinking] = useState<PhaseThinkingConfig | undefined>(
    settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING
  );

  const appRouting = useMemo(
    () => mergeRoutingWithFallback(
      normalizeRouting(settings.modelRouting),
      normalizeRouting(DEFAULT_MODEL_ROUTING)
    ),
    [settings.modelRouting]
  );
  const defaultIntakeModel = appRouting.features.intake.model
    ?? DEFAULT_MODEL_ROUTING.features.intake.model
    ?? selectedProfile.model;
  const [intakeModel, setIntakeModel] = useState<string>(defaultIntakeModel);
  const [intakePhase, setIntakePhase] = useState<'idle' | 'analyzing' | 'completed' | 'needs_clarify' | 'blocked'>('idle');
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeQuestions, setIntakeQuestions] = useState<ClarifyingQuestion[]>([]);
  const [intakeSourceDescription, setIntakeSourceDescription] = useState<string>('');
  const [showClarifyDialog, setShowClarifyDialog] = useState(false);
  const [clarifyIteration, setClarifyIteration] = useState(0);
  const [intakeRequestId, setIntakeRequestId] = useState<string | null>(null);
  const [seenBlockerActions, setSeenBlockerActions] = useState<Set<string>>(new Set());
  const [prevBlockerSignature, setPrevBlockerSignature] = useState<string>('');
  const { data: modelRegistry, isLoading: isLoadingRegistry } = useModelRegistry();
  const MAX_CLARIFY_ITERATIONS = 3;
  const intakeModelOptions = useMemo(() => {
    if (!modelRegistry?.models?.length) {
      return intakeModel ? [{ id: intakeModel, label: intakeModel }] : [];
    }

    const options = modelRegistry.models.map((model) => ({
      id: model.id,
      label: model.displayName || model.id
    }));

    if (intakeModel && !options.some((option) => option.id === intakeModel)) {
      options.unshift({ id: intakeModel, label: `Missing: ${intakeModel}` });
    }

    return options;
  }, [modelRegistry, intakeModel]);

  // Image attachments
  const [images, setImages] = useState<ImageAttachment[]>([]);

  // Referenced files from file explorer
  const [referencedFiles, setReferencedFiles] = useState<ReferencedFile[]>([]);

  // Review setting
  const [requireReviewBeforeCoding, setRequireReviewBeforeCoding] = useState(false);
  const [requireReviewBeforeMerge, setRequireReviewBeforeMerge] = useState(true);
  const [ralphLoop, setRalphLoop] = useState(false);
  const [skipIntake, setSkipIntake] = useState(false);

  // Draft state
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [pasteSuccess, setPasteSuccess] = useState(false);

  // Ref for the textarea to handle paste events
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Ref for the form scroll container (for drag auto-scroll)
  const formContainerRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop state for images over textarea
  const [isDragOverTextarea, setIsDragOverTextarea] = useState(false);

  // @ autocomplete state
  const [autocomplete, setAutocomplete] = useState<{
    show: boolean;
    query: string;
    startPos: number;
    position: { top: number; left: number };
  } | null>(null);

  // Load draft when dialog opens, or initialize from selected profile
  useEffect(() => {
    if (!open) return;

    const draft = loadDraft(draftProjectId);
    const shouldForceSandbox = forceSandbox;
    const draftSandbox = draft?.sandbox ?? false;
    const nextSandbox = shouldForceSandbox ? true : (sandboxTasksEnabled ? draftSandbox : false);
    setUseSandbox(nextSandbox);

    if (draft && !isDraftEmpty(draft)) {
      setTitle(draft.title);
      setDescription(draft.description);
      setCategory(draft.category);
      setPriority(draft.priority);
      setComplexity(draft.complexity);
      setImpact(draft.impact);
      // Load model/thinkingLevel/profileId from draft if present, otherwise use profile defaults
      setProfileId(draft.profileId || settings.selectedAgentProfile || 'auto');
      setModel(draft.model || selectedProfile.model);
      setThinkingLevel(draft.thinkingLevel || selectedProfile.thinkingLevel);
      setPhaseModels(draft.phaseModels || settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS);
      setPhaseThinking(draft.phaseThinking || settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING);
      setImages(draft.images);
      setReferencedFiles(draft.referencedFiles ?? []);
      setRequireReviewBeforeCoding(draft.requireReviewBeforeCoding ?? false);
      setRequireReviewBeforeMerge(draft.requireReviewBeforeMerge ?? true);
      setRalphLoop(draft.ralphLoop ?? false);
      setSkipIntake(draft.skipIntake ?? false);
      setIsDraftRestored(true);

      const intakeDraft = loadIntakeDraft(draftProjectId);
      if (intakeDraft && intakeDraft.sourceDescription === draft.description) {
        setIntakeResult(intakeDraft.intakeResult);
        setIntakePhase(intakeDraft.intakePhase);
        setIntakeModel(intakeDraft.intakeModel);
        setIntakeSourceDescription(intakeDraft.sourceDescription);
        setClarifyIteration(intakeDraft.iteration);
      } else {
        clearIntakeDraft(draftProjectId);
      }

      // Expand sections if they have content
      if (draft.category || draft.priority || draft.complexity || draft.impact) {
        setShowAdvanced(true);
      }
    } else {
      // No draft - initialize from selected profile and custom settings
      setProfileId(settings.selectedAgentProfile || 'auto');
      setModel(selectedProfile.model);
      setThinkingLevel(selectedProfile.thinkingLevel);
      setPhaseModels(settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS);
      setPhaseThinking(settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING);
      setUseSandbox(shouldForceSandbox);
    }
  }, [open, draftProjectId, forceSandbox, sandboxTasksEnabled, settings.selectedAgentProfile, settings.customPhaseModels, settings.customPhaseThinking, selectedProfile.model, selectedProfile.thinkingLevel]);

  useEffect(() => {
    if (!open) return;
    setIntakeModel(defaultIntakeModel);
  }, [open, defaultIntakeModel]);

  // Fetch branches and project default branch when dialog opens
  useEffect(() => {
    if (open && projectPath) {
      fetchBranches();
      fetchProjectDefaultBranch();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath]);

  useEffect(() => {
    if (useSandbox) {
      setShowGitOptions(false);
      setBaseBranch(PROJECT_DEFAULT_BRANCH);
      setUseWorktree(true);
    }
  }, [useSandbox]);

  const fetchBranches = async () => {
    if (!projectPath) return;

    setIsLoadingBranches(true);
    try {
      const result = await window.electronAPI.getGitBranches(projectPath);
      if (result.success && result.data) {
        setBranches(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch branches:', err);
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const fetchProjectDefaultBranch = async () => {
    if (!projectId) return;

    try {
      // Get env config to check if there's a configured default branch
      const result = await window.electronAPI.getProjectEnv(projectId);
      if (result.success && result.data?.defaultBranch) {
        setProjectDefaultBranch(result.data.defaultBranch);
      } else if (projectPath) {
        // Fall back to auto-detect
        const detectResult = await window.electronAPI.detectMainBranch(projectPath);
        if (detectResult.success && detectResult.data) {
          setProjectDefaultBranch(detectResult.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch project default branch:', err);
    }
  };

  /**
   * Get current form state as a draft
   */
  const getCurrentDraft = useCallback((): TaskDraft => ({
    projectId: draftProjectId,
    title,
    description,
    category,
    priority,
    complexity,
    impact,
    profileId,
    model,
    thinkingLevel,
    phaseModels,
    phaseThinking,
    images,
    referencedFiles,
    sandbox: useSandbox,
    requireReviewBeforeCoding,
    requireReviewBeforeMerge,
    ralphLoop,
    skipIntake,
    savedAt: new Date()
  }), [draftProjectId, title, description, category, priority, complexity, impact, profileId, model, thinkingLevel, phaseModels, phaseThinking, images, referencedFiles, useSandbox, requireReviewBeforeCoding, requireReviewBeforeMerge, ralphLoop, skipIntake]);
  /**
   * Handle paste event for screenshot support
   */
  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = e.clipboardData?.items;
    if (!clipboardItems) return;

    // Find image items in clipboard
    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      if (item.type.startsWith('image/')) {
        imageItems.push(item);
      }
    }

    // If no images, allow normal paste behavior
    if (imageItems.length === 0) return;

    // Prevent default paste when we have images
    e.preventDefault();

    // Check if we can add more images
    const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
    if (remainingSlots <= 0) {
      setError(`Maximum of ${MAX_IMAGES_PER_TASK} images allowed`);
      return;
    }

    setError(null);

    // Process image items
    const newImages: ImageAttachment[] = [];
    const existingFilenames = images.map(img => img.filename);

    for (const item of imageItems.slice(0, remainingSlots)) {
      const file = item.getAsFile();
      if (!file) continue;

      // Validate image type
      if (!isValidImageMimeType(file.type)) {
        setError(`Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES_DISPLAY}`);
        continue;
      }

      try {
        const dataUrl = await blobToBase64(file);
        const thumbnail = await createThumbnail(dataUrl);

        // Generate filename for pasted images (screenshot-timestamp.ext)
        const extension = file.type.split('/')[1] || 'png';
        const baseFilename = `screenshot-${Date.now()}.${extension}`;
        const resolvedFilename = resolveFilename(baseFilename, [
          ...existingFilenames,
          ...newImages.map(img => img.filename)
        ]);

        newImages.push({
          id: generateImageId(),
          filename: resolvedFilename,
          mimeType: file.type,
          size: file.size,
          data: dataUrl.split(',')[1], // Store base64 without data URL prefix
          thumbnail
        });
      } catch {
        setError('Failed to process pasted image');
      }
    }

    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages]);
      // Show success feedback
      setPasteSuccess(true);
      setTimeout(() => setPasteSuccess(false), 2000);
    }
  }, [images]);

  /**
   * Detect @ mention being typed and show autocomplete
   */
  const detectAtMention = useCallback((text: string, cursorPos: number) => {
    const beforeCursor = text.slice(0, cursorPos);
    // Match @ followed by optional path characters (letters, numbers, dots, dashes, slashes)
    const match = beforeCursor.match(/@([\w\-./\\]*)$/);

    if (match) {
      return {
        query: match[1],
        startPos: cursorPos - match[0].length
      };
    }
    return null;
  }, []);

  /**
   * Handle description change and check for @ mentions
   */
  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    setDescription(newValue);

    // Check for @ mention at cursor
    const mention = detectAtMention(newValue, cursorPos);

    if (mention) {
      // Calculate popup position based on cursor
      const textarea = descriptionRef.current;
      if (textarea) {
        const rect = textarea.getBoundingClientRect();
        const textareaStyle = window.getComputedStyle(textarea);
        const lineHeight = parseFloat(textareaStyle.lineHeight) || 20;
        const paddingTop = parseFloat(textareaStyle.paddingTop) || 8;
        const paddingLeft = parseFloat(textareaStyle.paddingLeft) || 12;

        // Estimate cursor position (simplified - assumes fixed-width font)
        const textBeforeCursor = newValue.slice(0, cursorPos);
        const lines = textBeforeCursor.split('\n');
        const currentLineIndex = lines.length - 1;
        const currentLineLength = lines[currentLineIndex].length;

        // Calculate position relative to textarea
        const charWidth = 8; // Approximate character width
        const top = paddingTop + (currentLineIndex + 1) * lineHeight + 4;
        const left = paddingLeft + Math.min(currentLineLength * charWidth, rect.width - 300);

        setAutocomplete({
          show: true,
          query: mention.query,
          startPos: mention.startPos,
          position: { top, left: Math.max(0, left) }
        });
      }
    } else {
      // No @ mention at cursor, close autocomplete
      if (autocomplete?.show) {
        setAutocomplete(null);
      }
    }
  }, [detectAtMention, autocomplete?.show]);

  /**
   * Handle autocomplete selection
   */
  const handleAutocompleteSelect = useCallback((filename: string) => {
    if (!autocomplete) return;

    const textarea = descriptionRef.current;
    if (!textarea) return;

    // Replace the @query with @filename
    const beforeMention = description.slice(0, autocomplete.startPos);
    const afterMention = description.slice(autocomplete.startPos + 1 + autocomplete.query.length);
    const newDescription = beforeMention + '@' + filename + afterMention;

    setDescription(newDescription);
    setAutocomplete(null);

    // Set cursor after the inserted mention
    setTimeout(() => {
      const newCursorPos = autocomplete.startPos + 1 + filename.length;
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [autocomplete, description]);

  /**
   * Close autocomplete
   */
  const handleAutocompleteClose = useCallback(() => {
    setAutocomplete(null);
  }, []);

  /**
   * Handle drag over the form container to auto-scroll when dragging near edges
   */
  const handleContainerDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    const container = formContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const edgeThreshold = 60; // px from edge to trigger scroll
    const scrollSpeed = 8;

    // Auto-scroll when dragging near top or bottom edges
    if (e.clientY < rect.top + edgeThreshold) {
      container.scrollTop -= scrollSpeed;
    } else if (e.clientY > rect.bottom - edgeThreshold) {
      container.scrollTop += scrollSpeed;
    }
  }, []);

  /**
   * Handle drag over textarea for image drops
   */
  const handleTextareaDragOver = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverTextarea(true);
  }, []);

  /**
   * Handle drag leave from textarea
   */
  const handleTextareaDragLeave = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverTextarea(false);
  }, []);

  /**
   * Handle drop on textarea for file references and images
   */
  const handleTextareaDrop = useCallback(
    async (e: DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOverTextarea(false);

      if (isCreating) return;

      // First, check for file reference drops (from the file explorer)
      const jsonData = e.dataTransfer?.getData('application/json');
      if (jsonData) {
        try {
          const data = JSON.parse(jsonData);
          if (data.type === 'file-reference' && data.name) {
            // Insert @mention at cursor position in the textarea
            const textarea = descriptionRef.current;
            if (textarea) {
              const cursorPos = textarea.selectionStart || 0;
              const textBefore = description.substring(0, cursorPos);
              const textAfter = description.substring(cursorPos);

              // Insert @mention at cursor position
              const mention = `@${data.name}`;
              const newDescription = textBefore + mention + textAfter;
              setDescription(newDescription);

              // Set cursor after the inserted mention
              setTimeout(() => {
                textarea.focus();
                const newCursorPos = cursorPos + mention.length;
                textarea.setSelectionRange(newCursorPos, newCursorPos);
              }, 0);

              return; // Don't process as image
            }
          }
        } catch {
          // Not valid JSON, continue to image handling
        }
      }

      // Fall back to image file handling
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Filter for image files
      const imageFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      // Check if we can add more images
      const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
      if (remainingSlots <= 0) {
        setError(`Maximum of ${MAX_IMAGES_PER_TASK} images allowed`);
        return;
      }

      setError(null);

      // Process image files
      const newImages: ImageAttachment[] = [];
      const existingFilenames = images.map(img => img.filename);

      for (const file of imageFiles.slice(0, remainingSlots)) {
        // Validate image type
        if (!isValidImageMimeType(file.type)) {
          setError(`Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES_DISPLAY}`);
          continue;
        }

        try {
          const dataUrl = await blobToBase64(file);
          const thumbnail = await createThumbnail(dataUrl);

          // Use original filename or generate one
          const baseFilename = file.name || `dropped-image-${Date.now()}.${file.type.split('/')[1] || 'png'}`;
          const resolvedFilename = resolveFilename(baseFilename, [
            ...existingFilenames,
            ...newImages.map(img => img.filename)
          ]);

          newImages.push({
            id: generateImageId(),
            filename: resolvedFilename,
            mimeType: file.type,
            size: file.size,
            data: dataUrl.split(',')[1], // Store base64 without data URL prefix
            thumbnail
          });
        } catch {
          setError('Failed to process dropped image');
        }
      }

      if (newImages.length > 0) {
        setImages(prev => [...prev, ...newImages]);
        // Show success feedback
        setPasteSuccess(true);
        setTimeout(() => setPasteSuccess(false), 2000);
      }
    },
    [images, isCreating, description]
  );

  /**
   * Parse @mentions from description and create ReferencedFile entries
   * Merges with existing referencedFiles, avoiding duplicates
   */
  const parseFileMentions = useCallback((text: string, existingFiles: ReferencedFile[]): ReferencedFile[] => {
    // Match @filename patterns (supports filenames with dots, hyphens, underscores, and path separators)
    const mentionRegex = /@([\w\-./\\]+\.\w+)/g;
    const matches = Array.from(text.matchAll(mentionRegex));

    if (matches.length === 0) return existingFiles;

    // Create a set of existing file names for quick lookup
    const existingNames = new Set(existingFiles.map(f => f.name));

    // Parse mentioned files that aren't already in the list
    const newFiles: ReferencedFile[] = [];
    matches.forEach(match => {
      const fileName = match[1];
      if (!existingNames.has(fileName)) {
        newFiles.push({
          id: crypto.randomUUID(),
          path: fileName, // Store relative path from @mention
          name: fileName,
          isDirectory: false,
          addedAt: new Date()
        });
        existingNames.add(fileName); // Prevent duplicates within mentions
      }
    });

    return [...existingFiles, ...newFiles];
  }, []);

  const resetIntakeState = useCallback(() => {
    setIntakePhase('idle');
    setIntakeResult(null);
    setIntakeError(null);
    setIntakeQuestions([]);
    setIntakeSourceDescription('');
    setShowClarifyDialog(false);
    setClarifyIteration(0);
    setIntakeRequestId(null);
    setSeenBlockerActions(new Set());
    setPrevBlockerSignature('');
  }, []);

  useEffect(() => {
    if (!intakeSourceDescription) return;
    if (intakePhase === 'analyzing') return;
    if (description.trim() !== intakeSourceDescription) {
      resetIntakeState();
    }
  }, [description, intakePhase, intakeSourceDescription, resetIntakeState]);

  useEffect(() => {
    if (intakePhase === 'needs_clarify' && intakeQuestions.length > 0) {
      setShowClarifyDialog(true);
    }
  }, [intakePhase, intakeQuestions]);

  const buildFallbackQuestions = useCallback(
    (): ClarifyingQuestion[] => [
      {
        id: 'q1',
        question: t('wizard.intake.fallbackSelectLabel'),
        type: 'multi_select',
        required: false,
        options: [
          t('wizard.intake.fallbackOptionLocation'),
          t('wizard.intake.fallbackOptionChange'),
          t('wizard.intake.fallbackOptionResult'),
          t('wizard.intake.fallbackOptionConstraints'),
          t('wizard.intake.fallbackOptionTesting')
        ]
      },
      {
        id: 'q2',
        question: t('wizard.intake.fallbackTextLabel'),
        type: 'text',
        required: false,
        options: []
      }
    ],
    [t]
  );

  const buildClarifyQuestions = useCallback(
    (questions: ClarifyingQuestion[]) =>
      questions.length > 0 ? questions : buildFallbackQuestions(),
    [buildFallbackQuestions]
  );

  useEffect(() => {
    if (!open) return;
    if (!intakeResult) return;
    if (intakePhase === 'idle' || intakePhase === 'analyzing') return;
    saveIntakeDraft({
      projectId: draftProjectId,
      intakeResult,
      intakePhase,
      intakeModel,
      iteration: clarifyIteration,
      sourceDescription: intakeSourceDescription || description.trim(),
      savedAt: new Date()
    });
  }, [open, intakeResult, intakePhase, intakeModel, clarifyIteration, intakeSourceDescription, description, draftProjectId]);

  const handleRunIntake = async () => {
    if (!description.trim()) {
      setIntakeError('Please provide a description before running intake.');
      return;
    }

    setIntakeError(null);
    setIntakePhase('analyzing');
    const requestId = crypto.randomUUID();
    setIntakeRequestId(requestId);

    try {
      const attachmentPaths = images
        .map((image) => image.path)
        .filter((value): value is string => Boolean(value));
      const result = await window.electronAPI.runIntakeAnalysis(
        draftProjectId,
        description.trim(),
        intakeModel,
        attachmentPaths.length ? attachmentPaths : undefined,
        requestId,
        1
      );

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Intake analysis failed.');
      }

      const data = result.data;
      const questions = buildClarifyQuestions(data.clarifyingQuestions || []);
      const blockerActions = (data.blockers ?? [])
        .map(extractBlockerAction)
        .filter((value) => value.length > 0);
      setIntakeResult(data);
      setIntakeSourceDescription(description.trim());
      setIntakeQuestions(questions);
      setClarifyIteration(0);
      setSeenBlockerActions(new Set(blockerActions));
      if (!title.trim() && data.suggestedTitle) {
        setTitle(data.suggestedTitle);
      }

      if (data.clarityLevel === 'high') {
        setIntakePhase('completed');
        setError(null);
      } else if (data.clarityLevel === 'medium') {
        setIntakePhase('needs_clarify');
        setError('Intake needs clarification before creating a task.');
      } else {
        setIntakePhase('needs_clarify');
        setError('Intake needs clarification before creating a task.');
        setShowClarifyDialog(true);
      }
    } catch (err) {
      // Intentional asymmetry: initial intake failures go back to idle so the user can retry from scratch.
      setIntakePhase('idle');
      setIntakeError(err instanceof Error ? err.message : 'Intake analysis failed.');
    }
  };

  const handleIntakeAction = () => {
    if (intakePhase === 'needs_clarify') {
      if (intakeQuestions.length === 0) {
        setIntakeQuestions(buildFallbackQuestions());
      }
      setShowClarifyDialog(true);
      return;
    }
    handleRunIntake();
  };

  const handleClarifySubmit = async (answers: ClarifyAnswers) => {
    if (clarifyIteration >= MAX_CLARIFY_ITERATIONS) {
      setIntakePhase('blocked');
      setShowClarifyDialog(false);
      setError('Clarification limit reached. Please уточните задачу.');
      return;
    }

    setShowClarifyDialog(false);
    setIntakePhase('analyzing');
    setIntakeError(null);

    try {
      const formatClarifyAnswers = (
        questions: ClarifyingQuestion[],
        values: ClarifyAnswers
      ) => {
        const lines: string[] = [];
        questions.forEach((question) => {
          const value = values[question.id];
          if (question.type === 'multi_select' && Array.isArray(value) && value.length) {
            lines.push(`Already specified: ${value.join(', ')}`);
          } else if (question.type === 'single_select' && typeof value === 'string' && value.trim()) {
            lines.push(`${question.question}: ${value.trim()}`);
          } else if (question.type === 'text' && typeof value === 'string' && value.trim()) {
            lines.push(value.trim());
          }
        });
        return lines.join('\n');
      };

      const answersSummary = formatClarifyAnswers(intakeQuestions, answers);
      const reanalyzeDescription = answersSummary
        ? `${description.trim()}\n\nClarifications:\n${answersSummary}`
        : description.trim();
      if (reanalyzeDescription !== description.trim()) {
        setDescription(reanalyzeDescription);
        setIntakeSourceDescription(reanalyzeDescription);
      }
      const attachmentPaths = images
        .map((image) => image.path)
        .filter((value): value is string => Boolean(value));
      const requestId = intakeRequestId ?? crypto.randomUUID();
      if (!intakeRequestId) {
        setIntakeRequestId(requestId);
      }
      const result = await window.electronAPI.runIntakeReanalyze(
        draftProjectId,
        reanalyzeDescription,
        intakeModel,
        answers,
        attachmentPaths.length ? attachmentPaths : undefined,
        requestId,
        clarifyIteration + 1
      );

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Intake reanalysis failed.');
      }

      const data = result.data;
      const questions = buildClarifyQuestions(data.clarifyingQuestions || []);
      const blockerActions = (data.blockers ?? [])
        .map(extractBlockerAction)
        .filter((value) => value.length > 0);
      const blockerSignature = createBlockerSignature(data.blockers ?? []);

      // P1-2: Anti-cycle detection — if same blocker signature repeats, stop early
      if (blockerSignature.length > 0 && blockerSignature === prevBlockerSignature) {
        console.info('[intake] Detected blocker cycle, stopping early:', blockerSignature);
        setIntakeResult(data);
        setIntakePhase('blocked');
        setError('Intake is cycling on the same blockers. Please rephrase the task or provide more detail.');
        return;
      }
      setPrevBlockerSignature(blockerSignature);

      const dedupedQuestions = questions.filter((_question, index) => {
        const blockerAction = blockerActions[index];
        if (!blockerAction) {
          return true;
        }
        return !seenBlockerActions.has(blockerAction);
      });

      setSeenBlockerActions((prev) => {
        const next = new Set(prev);
        blockerActions.forEach((action) => next.add(action));
        return next;
      });

      if (dedupedQuestions.length !== questions.length) {
        console.info('[intake] Deduplicated clarify questions for repeated blocker actions', {
          blockerSignature,
          removed: questions.length - dedupedQuestions.length
        });
      }

      setIntakeResult(data);
      setIntakeSourceDescription(reanalyzeDescription);
      setIntakeQuestions(dedupedQuestions);
      const nextIteration = clarifyIteration + 1;
      setClarifyIteration(nextIteration);

      if (data.clarityLevel === 'high') {
        setIntakePhase('completed');
        setError(null);
        return;
      }

      if (nextIteration >= MAX_CLARIFY_ITERATIONS) {
        setIntakePhase('blocked');
        setError('Clarification limit reached. Please уточните задачу.');
        return;
      }

      if (dedupedQuestions.length === 0) {
        setIntakePhase('blocked');
        setError('No new clarifications were produced. Please уточните задачу.');
      } else {
        setIntakePhase('needs_clarify');
        setError('Intake needs clarification before creating a task.');
      }
    } catch (err) {
      // Intentional asymmetry: reanalyze failures stay in needs_clarify to preserve prior context and answers.
      setIntakePhase('needs_clarify');
      setIntakeError(err instanceof Error ? err.message : 'Intake reanalysis failed.');
    }
  };

  /**
   * Opens Insights for additional context gathering without changing intake gating.
   * This action never sets intake as completed and does not unlock task creation.
   */
  const handleCollectContext = useCallback(async () => {
    if (!projectId) {
      setError('Select a project before collecting context.');
      return;
    }
    if (!description.trim()) {
      setError('Provide a description before collecting context.');
      return;
    }

    const questions = intakeQuestions.length
      ? `\n\nClarifying questions:\n${intakeQuestions.map((q) => `- ${q.question}`).join('\n')}`
      : '';

    const prompt = [
      'Collect helpful context, edge cases, and successful examples for this task.',
      '',
      `Task description: ${description.trim()}`,
      questions
    ].join('\n').trim();

    try {
      setShowClarifyDialog(false);
      onOpenInsights?.();
      await loadInsightsSession(projectId);
      sendMessage(projectId, prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to collect context.');
    }
  }, [projectId, description, intakeQuestions, onOpenInsights]);

  const handleCreate = async () => {
    if (!description.trim()) {
      setError('Please provide a description');
      return;
    }
    if (!skipIntake && (intakePhase !== 'completed' || !intakeResult)) {
      setError('Complete intake analysis before creating the task.');
      return;
    }

    const shouldUseSandbox = sandboxTasksEnabled && (useSandbox || !projectId);
    if (!projectId && !shouldUseSandbox) {
      setError('Select a project or enable sandbox mode');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Parse @mentions from description and merge with referenced files
      const allReferencedFiles = parseFileMentions(description, referencedFiles);

      // Build metadata from selected values
      const metadata: TaskMetadata = {
        sourceType: 'manual'
      };

      if (category) metadata.category = category;
      if (priority) metadata.priority = priority;
      if (complexity) metadata.complexity = complexity;
      if (impact) metadata.impact = impact;
      if (model) metadata.model = model;
      if (thinkingLevel) metadata.thinkingLevel = thinkingLevel;
      // Auto profile uses per-phase configuration; custom uses single model selection
      if (profileId !== 'custom' && phaseModels && phaseThinking) {
        metadata.isAutoProfile = true;
        metadata.phaseModels = phaseModels;
        metadata.phaseThinking = phaseThinking;
      }
      if (images.length > 0) metadata.attachedImages = images;
      if (allReferencedFiles.length > 0) metadata.referencedFiles = allReferencedFiles;
      if (requireReviewBeforeCoding) metadata.requireReviewBeforeCoding = true;
      metadata.requireReviewBeforeMerge = requireReviewBeforeMerge;
      if (ralphLoop) metadata.ralphLoop = true;
      if (shouldUseSandbox) metadata.sandbox = true;
      if (!skipIntake && intakeResult) {
        metadata.intakeResult = {
          ...intakeResult,
          intakeModel: intakeResult.intakeModel || intakeModel
        };
      }
      if (skipIntake) {
        metadata.intakeSkipped = true;
      }
      // Only include baseBranch if it's not the project default placeholder
      if (!shouldUseSandbox && baseBranch && baseBranch !== PROJECT_DEFAULT_BRANCH) metadata.baseBranch = baseBranch;
      // Pass worktree preference - false means use --direct mode
      if (!useWorktree) metadata.useWorktree = false;

      if (shouldUseSandbox) {
        const result = await createSandboxTask(
          title.trim(),
          description.trim(),
          metadata,
          projectId
        );
        if (result) {
          clearDraft(draftProjectId);
          clearIntakeDraft(draftProjectId);
          if (!projects.find((p) => p.id === result.project.id)) {
            addProjectToStore(result.project);
          }
          openProjectTab(result.project.id);
          resetForm();
          onOpenChange(false);
        } else {
          setError('Failed to create sandbox task. Please try again.');
        }
      } else {
        // Title is optional - if empty, it will be auto-generated by the backend
        const task = await createTask(projectId!, title.trim(), description.trim(), metadata);
        if (task) {
          // Clear draft on successful creation
          clearDraft(draftProjectId);
          clearIntakeDraft(draftProjectId);
          // Reset form and close
          resetForm();
          onOpenChange(false);
        } else {
          setError('Failed to create task. Please try again.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsCreating(false);
    }
  };

  const showCreateUnlockHint =
    !skipIntake && (intakePhase === 'needs_clarify' || intakePhase === 'blocked');

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('');
    setPriority('');
    setComplexity('');
    setImpact('');
    // Reset to selected profile defaults and custom settings
    setProfileId(settings.selectedAgentProfile || 'auto');
    setModel(selectedProfile.model);
    setThinkingLevel(selectedProfile.thinkingLevel);
    setPhaseModels(settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS);
    setPhaseThinking(settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING);
    setImages([]);
    setReferencedFiles([]);
    setRequireReviewBeforeCoding(false);
    setRequireReviewBeforeMerge(true);
    setSkipIntake(false);
    setBaseBranch(PROJECT_DEFAULT_BRANCH);
    setUseWorktree(true);
    setUseSandbox(forceSandbox);
    setIntakePhase('idle');
    setIntakeResult(null);
    setIntakeError(null);
    setIntakeQuestions([]);
    setIntakeSourceDescription('');
    setIntakeModel(defaultIntakeModel);
    setError(null);
    setShowAdvanced(false);
    setShowFileExplorer(false);
    setShowGitOptions(false);
    setIsDraftRestored(false);
    setPasteSuccess(false);
  };

  /**
   * Handle dialog close - save draft if content exists
   */
  const handleClose = () => {
    if (isCreating) return;

    const draft = getCurrentDraft();

    // Save draft if there's any content
    if (!isDraftEmpty(draft)) {
      saveDraft(draft);
    } else {
      // Clear any existing draft if form is empty
      clearDraft(draftProjectId);
    }

    resetForm();
    onOpenChange(false);
  };

  /**
   * Discard draft and start fresh
   */
  const handleDiscardDraft = () => {
    clearDraft(draftProjectId);
    clearIntakeDraft(draftProjectId);
    resetForm();
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          "max-h-[90vh] p-0 overflow-hidden transition-all duration-300 ease-out",
          showFileExplorer ? "sm:max-w-[900px]" : "sm:max-w-[550px]"
        )}
        hideCloseButton={showFileExplorer}
      >
        <div className="flex h-full min-h-0 overflow-hidden">
          {/* Form content */}
          <div
            ref={formContainerRef}
            onDragOver={handleContainerDragOver}
            className="flex-1 flex flex-col p-6 min-w-0 min-h-0 overflow-y-auto relative"
          >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-foreground">Create New Task</DialogTitle>
            {isDraftRestored && (
              <div className="flex items-center gap-2">
                <span className="text-xs bg-info/10 text-info px-2 py-1 rounded-md">
                  Draft restored
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleDiscardDraft}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Start Fresh
                </Button>
              </div>
            )}
          </div>
          <DialogDescription>
            Describe what you want to build. The AI will analyze your request and
            create a detailed specification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Description (Primary - Required) */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium text-foreground">
              Description <span className="text-destructive">*</span>
            </Label>
            {/* Wrap textarea for file @mentions */}
            <div className="relative">
              {/* Syntax highlight overlay for @mentions */}
              <div
                className="absolute inset-0 pointer-events-none overflow-hidden rounded-md border border-transparent"
                style={{
                  padding: '0.5rem 0.75rem',
                  font: 'inherit',
                  lineHeight: '1.5',
                  wordWrap: 'break-word',
                  whiteSpace: 'pre-wrap',
                  color: 'transparent'
                }}
              >
                {description.split(/(@[\w\-./\\]+\.\w+)/g).map((part, i) => {
                  // Check if this part is an @mention
                  if (part.match(/^@[\w\-./\\]+\.\w+$/)) {
                    return (
                      <span
                        key={i}
                        className="bg-info/20 text-info-foreground rounded px-0.5"
                        style={{ color: 'hsl(var(--info))' }}
                      >
                        {part}
                      </span>
                    );
                  }
                  return <span key={i}>{part}</span>;
                })}
              </div>
              <Textarea
                ref={descriptionRef}
                id="description"
                placeholder="Describe the feature, bug fix, or improvement you want to implement. Be as specific as possible about requirements, constraints, and expected behavior. Type @ to reference files."
                value={description}
                onChange={handleDescriptionChange}
                onPaste={handlePaste}
                onDragOver={handleTextareaDragOver}
                onDragLeave={handleTextareaDragLeave}
                onDrop={handleTextareaDrop}
                rows={5}
                disabled={isCreating}
                aria-required="true"
                aria-describedby="description-help"
                className={cn(
                  "resize-y min-h-[120px] max-h-[400px] relative bg-transparent",
                  // Visual feedback when dragging over textarea
                  isDragOverTextarea && !isCreating && "border-primary bg-primary/5 ring-2 ring-primary/20"
                )}
                style={{ caretColor: 'auto' }}
              />
              {/* File autocomplete popup */}
              {autocomplete?.show && projectPath && (
                <FileAutocomplete
                  query={autocomplete.query}
                  projectPath={projectPath}
                  position={autocomplete.position}
                  onSelect={handleAutocompleteSelect}
                  onClose={handleAutocompleteClose}
                />
              )}
            </div>
            <p id="description-help" className="text-xs text-muted-foreground">
              Files and images can be copy/pasted or dragged & dropped into the description.
            </p>

            {/* Image Thumbnails - displayed inline below description */}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="relative group rounded-md border border-border overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                    style={{ width: '64px', height: '64px' }}
                    onClick={() => {
                      // Open full-size image in a new window/modal could be added here
                    }}
                    title={image.filename}
                  >
                    {image.thumbnail ? (
                      <img
                        src={image.thumbnail}
                        alt={image.filename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    {/* Remove button */}
                    {!isCreating && (
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setImages(prev => prev.filter(img => img.id !== image.id));
                        }}
                        aria-label={t('images.removeImageAriaLabel', { filename: image.filename })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Intake Analysis */}
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-muted-foreground">
                {t('wizard.intake.title')}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleIntakeAction}
                disabled={isCreating || intakePhase === 'analyzing' || !description.trim() || skipIntake}
              >
                {intakePhase === 'analyzing' && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {intakePhase === 'needs_clarify'
                  ? t('wizard.intake.openClarify')
                  : intakePhase === 'completed'
                    ? t('wizard.intake.rerun')
                    : t('wizard.intake.run')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{t('wizard.intake.statusLabel')}:</span>
              <IntakeProgressIndicator phase={intakePhase} />
              {intakeError && (
                <span className="text-destructive">{intakeError}</span>
              )}
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="skip-intake"
                checked={skipIntake}
                onCheckedChange={(checked) => setSkipIntake(checked === true)}
                disabled={isCreating}
                className="mt-0.5"
              />
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor="skip-intake"
                  className="text-xs font-medium text-muted-foreground cursor-pointer"
                >
                  {t('wizard.intake.skipLabel')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('wizard.intake.skipHint')}
                </p>
              </div>
            </div>
            {intakePhase === 'needs_clarify' && intakeQuestions.length > 0 && (
              <p className="text-xs text-destructive">
                {t('wizard.intake.needsClarifyHint')}
              </p>
            )}
            {intakePhase === 'blocked' && (
              <p className="text-xs text-destructive">
                {t('wizard.intake.blockedHint')}
              </p>
            )}
          </div>

          {/* Title (Optional - Auto-generated if empty) */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-medium text-foreground">
              Task Title <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="title"
              placeholder="Leave empty to auto-generate from description"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isCreating}
            />
            <p className="text-xs text-muted-foreground">
              A short, descriptive title will be generated automatically if left empty.
            </p>
          </div>

          {/* Sandbox Isolation */}
          {sandboxTasksEnabled && (
            <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="sandbox-task"
                  checked={useSandbox}
                  onCheckedChange={(checked) => setUseSandbox(checked === true)}
                  disabled={isCreating || !hasProject}
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-1">
                  <Label
                    htmlFor="sandbox-task"
                    className="text-sm font-medium text-foreground cursor-pointer"
                  >
                    Create in sandbox (new repo per task)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {hasProject
                      ? 'Creates an isolated repo and runs this task in a clean workspace.'
                      : 'Sandbox is required when no project is selected.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Agent Profile Selection */}
          <AgentProfileSelector
            profileId={profileId}
            model={model}
            thinkingLevel={thinkingLevel}
            phaseModels={phaseModels}
            phaseThinking={phaseThinking}
            onProfileChange={(newProfileId, newModel, newThinkingLevel) => {
              setProfileId(newProfileId);
              setModel(newModel);
              setThinkingLevel(newThinkingLevel);
            }}
            onModelChange={setModel}
            onThinkingLevelChange={setThinkingLevel}
            onPhaseModelsChange={setPhaseModels}
            onPhaseThinkingChange={setPhaseThinking}
            disabled={isCreating}
          />

          {/* Intake Model Selection */}
          <div className="space-y-2">
            <Label htmlFor="intake-model" className="text-xs font-medium text-muted-foreground">
              {t('wizard.intake.modelLabel')}
            </Label>
            <Select
              value={intakeModel}
              onValueChange={(value) => setIntakeModel(value)}
              disabled={isCreating || isLoadingRegistry}
            >
              <SelectTrigger id="intake-model" className="h-9">
                <SelectValue placeholder={t('wizard.intake.modelPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {intakeModelOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('wizard.intake.modelHint')}
            </p>
          </div>

          {/* Paste Success Indicator */}
          {pasteSuccess && (
            <div className="flex items-center gap-2 text-sm text-success animate-in fade-in slide-in-from-top-1 duration-200">
              <ImageIcon className="h-4 w-4" />
              Image added successfully!
            </div>
          )}

          {/* Advanced Options Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={cn(
              'flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors',
              'w-full justify-between py-2 px-3 rounded-md hover:bg-muted/50'
            )}
            disabled={isCreating}
            aria-expanded={showAdvanced}
            aria-controls="advanced-options-section"
          >
            <span>Classification (optional)</span>
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {/* Advanced Options */}
          {showAdvanced && (
            <div id="advanced-options-section" className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
              <div className="grid grid-cols-2 gap-4">
                {/* Category */}
                <div className="space-y-2">
                  <Label htmlFor="category" className="text-xs font-medium text-muted-foreground">
                    Category
                  </Label>
                  <Select
                    value={category}
                    onValueChange={(value) => setCategory(value as TaskCategory)}
                    disabled={isCreating}
                  >
                    <SelectTrigger id="category" className="h-9">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TASK_CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Priority */}
                <div className="space-y-2">
                  <Label htmlFor="priority" className="text-xs font-medium text-muted-foreground">
                    Priority
                  </Label>
                  <Select
                    value={priority}
                    onValueChange={(value) => setPriority(value as TaskPriority)}
                    disabled={isCreating}
                  >
                    <SelectTrigger id="priority" className="h-9">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Complexity */}
                <div className="space-y-2">
                  <Label htmlFor="complexity" className="text-xs font-medium text-muted-foreground">
                    Complexity
                  </Label>
                  <Select
                    value={complexity}
                    onValueChange={(value) => setComplexity(value as TaskComplexity)}
                    disabled={isCreating}
                  >
                    <SelectTrigger id="complexity" className="h-9">
                      <SelectValue placeholder="Select complexity" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TASK_COMPLEXITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Impact */}
                <div className="space-y-2">
                  <Label htmlFor="impact" className="text-xs font-medium text-muted-foreground">
                    Impact
                  </Label>
                  <Select
                    value={impact}
                    onValueChange={(value) => setImpact(value as TaskImpact)}
                    disabled={isCreating}
                  >
                    <SelectTrigger id="impact" className="h-9">
                      <SelectValue placeholder="Select impact" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TASK_IMPACT_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                These labels help organize and prioritize tasks. They&apos;re optional but useful for filtering.
              </p>
            </div>
          )}

          {/* Review Requirement Toggles */}
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="flex items-start gap-3">
              <Checkbox
                id="require-review"
                checked={requireReviewBeforeCoding}
                onCheckedChange={(checked) => setRequireReviewBeforeCoding(checked === true)}
                disabled={isCreating}
                className="mt-0.5"
              />
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor="require-review"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  Require human review before coding
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, you&apos;ll be prompted to review the spec and implementation plan before the coding phase begins. This allows you to approve, request changes, or provide feedback.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="require-merge-review"
                checked={requireReviewBeforeMerge}
                onCheckedChange={(checked) => setRequireReviewBeforeMerge(checked === true)}
                disabled={isCreating}
                className="mt-0.5"
              />
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor="require-merge-review"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  Require human review before merge
                </Label>
                <p className="text-xs text-muted-foreground">
                  When disabled, completed tasks will auto-merge and move to Done without waiting in Human Review.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="ralph-loop"
                checked={ralphLoop}
                onCheckedChange={(checked) => setRalphLoop(checked === true)}
                disabled={isCreating}
                className="mt-0.5"
              />
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor="ralph-loop"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  Enable Ralph-loop (iterate until passes)
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, Auto-iFlow will re-run the build loop until QA passes or the loop limit is reached.
                </p>
              </div>
            </div>
          </div>

          {/* Git Options Toggle */}
          <button
            type="button"
            onClick={() => setShowGitOptions(!showGitOptions)}
            className={cn(
              'flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors',
              'w-full justify-between py-2 px-3 rounded-md hover:bg-muted/50'
            )}
            disabled={isCreating || useSandbox}
            aria-expanded={showGitOptions}
            aria-controls="git-options-section"
          >
            <span className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Git Options (optional)
              {baseBranch && baseBranch !== PROJECT_DEFAULT_BRANCH && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  {baseBranch}
                </span>
              )}
            </span>
            {showGitOptions ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {/* Git Options */}
          {showGitOptions && (
            <div id="git-options-section" className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
              <div className="space-y-2">
                <Label htmlFor="base-branch" className="text-sm font-medium text-foreground">
                  Base Branch (optional)
                </Label>
                <Select
                  value={baseBranch}
                  onValueChange={setBaseBranch}
                  disabled={isCreating || isLoadingBranches || useSandbox}
                >
                  <SelectTrigger id="base-branch" className="h-9">
                    <SelectValue placeholder={`Use project default${projectDefaultBranch ? ` (${projectDefaultBranch})` : ''}`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PROJECT_DEFAULT_BRANCH}>
                      Use project default{projectDefaultBranch ? ` (${projectDefaultBranch})` : ''}
                    </SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Override the branch this task&apos;s worktree will be created from. Leave empty to use the project&apos;s configured default branch.
                </p>
              </div>

              {/* Workspace Isolation Toggle */}
              <div className="flex items-start space-x-3 pt-2 border-t border-border/50">
                <Checkbox
                  id="use-worktree"
                  checked={useWorktree}
                  onCheckedChange={(checked) => setUseWorktree(checked === true)}
                  disabled={isCreating || useSandbox}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="use-worktree"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t('wizard.gitOptions.useWorktreeLabel')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('wizard.gitOptions.useWorktreeDescription')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive" role="alert">
              <X className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center gap-2">
            {/* File Explorer Toggle Button */}
            {projectPath && (
              <Button
                type="button"
                variant={showFileExplorer ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowFileExplorer(!showFileExplorer)}
                disabled={isCreating}
                className="gap-1.5"
              >
                <FolderTree className="h-4 w-4" />
                {showFileExplorer ? 'Hide Files' : 'Browse Files'}
              </Button>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            {showCreateUnlockHint && (
              <p className="text-right text-xs text-destructive">
                {t('wizard.intake.createUnlockHint')}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isCreating}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  isCreating
                  || !description.trim()
                  || (!skipIntake && intakePhase !== 'completed')
                  || (!projectId && !(sandboxTasksEnabled && useSandbox))
                }
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Task'
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
          </div>

          {/* File Explorer Drawer */}
          {projectPath && (
            <TaskFileExplorerDrawer
              isOpen={showFileExplorer}
              onClose={() => setShowFileExplorer(false)}
              projectPath={projectPath}
            />
          )}
        </div>
      </DialogContent>
      <ClarifyTaskDialog
        open={showClarifyDialog}
        questions={intakeQuestions}
        iteration={clarifyIteration}
        maxIterations={MAX_CLARIFY_ITERATIONS}
        onSubmit={handleClarifySubmit}
        onCollectContext={handleCollectContext}
        onClose={() => setShowClarifyDialog(false)}
      />
    </Dialog>
  );
}
