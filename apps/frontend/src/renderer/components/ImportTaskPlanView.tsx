import { PlanImportSection } from './project-settings/PlanImportSection';

interface ImportTaskPlanViewProps {
  projectId: string;
}

export function ImportTaskPlanView({ projectId }: ImportTaskPlanViewProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        <PlanImportSection projectId={projectId} />
      </div>
    </div>
  );
}
