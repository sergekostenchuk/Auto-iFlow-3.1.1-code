import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Wrench } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog';
import { Checkbox } from '../ui/checkbox';
import { cn, formatRelativeTime } from '../../lib/utils';
import type { Task, PostCodeTestsReport, PostCodeTestsFixOptions } from '../../../shared/types';

type ScopeContract = {
  intent?: string;
  outcome?: string;
  where?: string;
  why?: string;
  when?: string;
  acceptance?: string[];
  test_plan?: string[];
  allowed_paths?: string[];
  forbidden_paths?: string[];
};

type ScopeReview = {
  approved?: boolean;
  errors?: string[];
  warnings?: string[];
  created_at?: string;
};

type ScopePreflightReport = {
  status?: string;
  errors?: string[];
  warnings?: string[];
  fixes?: string[];
  scope_file?: string;
  created_at?: string;
};

interface TaskQualityChecksProps {
  task: Task;
  allowMergeWithoutTests?: boolean;
  onAllowMergeWithoutTestsChange?: (value: boolean) => void;
}

const joinSpecPath = (specsPath: string, filename: string) => {
  const normalized = specsPath.replace(/\\/g, '/');
  return normalized.endsWith('/') ? `${normalized}${filename}` : `${normalized}/${filename}`;
};

function getStatusBadge(status?: string) {
  if (!status) {
    return <Badge variant="muted">Not run</Badge>;
  }
  if (status === 'passed') {
    return <Badge variant="success">Passed</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="destructive">Failed</Badge>;
  }
  if (status === 'skipped') {
    return <Badge variant="secondary">Skipped</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

export function TaskQualityChecks({ task, allowMergeWithoutTests, onAllowMergeWithoutTestsChange }: TaskQualityChecksProps) {
  const [scopeContract, setScopeContract] = useState<ScopeContract | null>(null);
  const [scopeReview, setScopeReview] = useState<ScopeReview | null>(null);
  const [postCodeTests, setPostCodeTests] = useState<PostCodeTestsReport | null>(null);
  const [preflightReport, setPreflightReport] = useState<ScopePreflightReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [isFixingTests, setIsFixingTests] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showFixConfirm, setShowFixConfirm] = useState(false);
  const [fixUpgradePip, setFixUpgradePip] = useState(false);

  const loadJsonFile = useCallback(async (filename: string) => {
    if (!task.specsPath) return null;
    try {
      const filePath = joinSpecPath(task.specsPath, filename);
      const result = await window.electronAPI.readFile(filePath);
      if (!result.success || result.data === undefined) {
        return null;
      }
      return JSON.parse(result.data);
    } catch (err) {
      console.error(`Failed to load ${filename}:`, err);
      return null;
    }
  }, [task.specsPath]);

  const refreshData = useCallback(async () => {
    if (!task.specsPath) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [contract, review, tests] = await Promise.all([
        loadJsonFile('scope_contract.json'),
        loadJsonFile('scope_review.json'),
        loadJsonFile('post_code_tests.json'),
      ]);
      const report = await loadJsonFile('scope_preflight_report.json');

      setScopeContract(contract);
      setScopeReview(review);
      setPostCodeTests(tests);
      setPreflightReport(report);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load quality data');
    } finally {
      setIsLoading(false);
    }
  }, [loadJsonFile, task.specsPath]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const handleRunPostCodeTests = async () => {
    setActionMessage(null);
    setActionError(null);
    setIsRunningTests(true);
    try {
      const result = await window.electronAPI.runPostCodeTests(task.id, { force: true });
      if (!result.success || !result.data) {
        setActionError(result.error || 'Failed to run post-code tests');
        return;
      }
      setPostCodeTests(result.data.report);
      if (result.data.report?.status === 'failed') {
        setActionError(result.data.report.reason || result.data.report.error || 'Post-code tests failed');
      } else {
        setActionMessage('Post-code tests updated');
      }
      await refreshData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to run post-code tests');
    } finally {
      setIsRunningTests(false);
    }
  };

  const handleFixPostCodeTests = async (options?: PostCodeTestsFixOptions) => {
    setActionMessage(null);
    setActionError(null);
    setIsFixingTests(true);
    try {
      const result = await window.electronAPI.fixPostCodeTests(task.id, options);
      if (!result.success || !result.data) {
        setActionError(result.error || 'Failed to apply fix');
        return;
      }
      if (result.data.report) {
        setPostCodeTests(result.data.report);
      }
      if (result.data.applied === false) {
        setActionError(result.data.message || 'Fix could not be applied');
      } else if (result.data.report?.status === 'failed') {
        setActionError(result.data.message || result.data.report.reason || result.data.report.error || 'Post-code tests still failing');
      } else {
        setActionMessage(result.data.message);
      }
      await refreshData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to apply fix');
    } finally {
      setIsFixingTests(false);
    }
  };

  const failedResult = postCodeTests?.results?.find((result) => result.status !== 'passed');
  const postCodeStatus = postCodeTests?.status;
  const postCodeTestsFailed = Boolean(postCodeStatus && postCodeStatus === 'failed');
  const postCodeTestsMissing = !postCodeStatus;
  const shouldShowOverride = postCodeTestsFailed || postCodeTestsMissing;
  const failureDetail =
    failedResult?.stderr ||
    failedResult?.stdout ||
    postCodeTests?.reason ||
    postCodeTests?.error ||
    actionError;

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Quality Guardrails</p>
          <h3 className="text-sm font-semibold text-foreground">Scope & Test Controls</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={refreshData}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" />
          {loadError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scope Contract</span>
            {scopeContract ? <Badge variant="success">Available</Badge> : <Badge variant="muted">Missing</Badge>}
          </div>
          {scopeContract ? (
            <div className="space-y-2 text-xs text-foreground/80">
              <div className="flex flex-wrap gap-2">
                {scopeContract.intent && <Badge variant="secondary">Intent: {scopeContract.intent}</Badge>}
                {scopeContract.when && <Badge variant="outline">{scopeContract.when}</Badge>}
              </div>
              {scopeContract.outcome && (
                <p className="text-xs text-foreground/80">{scopeContract.outcome}</p>
              )}
              {scopeContract.allowed_paths && scopeContract.allowed_paths.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Allowed paths</p>
                  <div className="flex flex-wrap gap-1">
                    {scopeContract.allowed_paths.map((path) => (
                      <Badge key={path} variant="outline" className="text-[11px]">
                        {path}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {scopeContract.forbidden_paths && scopeContract.forbidden_paths.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Forbidden paths</p>
                  <div className="flex flex-wrap gap-1">
                    {scopeContract.forbidden_paths.map((path) => (
                      <Badge key={path} variant="warning" className="text-[11px]">
                        {path}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {preflightReport?.status === 'failed' && (
                <div className="text-destructive space-y-1">
                  <p className="text-[11px] uppercase tracking-wide">Preflight errors</p>
                  {(preflightReport.errors || []).map((error, idx) => (
                    <p key={`${error}-${idx}`} className="text-xs">{error}</p>
                  ))}
                  {preflightReport.fixes && preflightReport.fixes.length > 0 && (
                    <>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-2">Suggested fixes</p>
                      {preflightReport.fixes.map((fix, idx) => (
                        <p key={`${fix}-${idx}`} className="text-xs text-muted-foreground">{fix}</p>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>scope_contract.json not found.</p>
              {preflightReport?.status === 'failed' && (
                <div className="text-destructive space-y-1">
                  <p className="text-[11px] uppercase tracking-wide">Preflight errors</p>
                  {(preflightReport.errors || []).map((error, idx) => (
                    <p key={`${error}-${idx}`} className="text-xs">{error}</p>
                  ))}
                  {preflightReport.fixes && preflightReport.fixes.length > 0 && (
                    <>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-2">Suggested fixes</p>
                      {preflightReport.fixes.map((fix, idx) => (
                        <p key={`${fix}-${idx}`} className="text-xs text-muted-foreground">{fix}</p>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Senior Review</span>
            {scopeReview ? (
              scopeReview.approved ? (
                <Badge variant="success">Approved</Badge>
              ) : (
                <Badge variant="destructive">Needs clarification</Badge>
              )
            ) : (
              <Badge variant="muted">Not run</Badge>
            )}
          </div>
          {scopeReview ? (
            <div className="space-y-2 text-xs text-foreground/80">
              <div className="flex flex-wrap gap-3">
                {typeof scopeReview.approved === 'boolean' && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {scopeReview.approved ? 'Approved' : 'Blocked'}
                  </span>
                )}
                {scopeReview.created_at && (
                  <span className="text-muted-foreground">
                    {formatRelativeTime(new Date(scopeReview.created_at))}
                  </span>
                )}
              </div>
              {scopeReview.errors && scopeReview.errors.length > 0 && (
                <div className="text-destructive">
                  {scopeReview.errors.length} errors
                </div>
              )}
              {scopeReview.warnings && scopeReview.warnings.length > 0 && (
                <div className="text-warning">
                  {scopeReview.warnings.length} warnings
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">scope_review.json not found.</p>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Post-Code Tests</span>
          {getStatusBadge(postCodeTests?.status)}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleRunPostCodeTests}
              disabled={isRunningTests}
              title="Re-run post-code tests"
            >
              <RefreshCw className={cn('h-4 w-4', isRunningTests && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowFixConfirm(true)}
              disabled={isFixingTests}
              title="Fix common test failures"
            >
              <Wrench className={cn('h-4 w-4', isFixingTests && 'animate-spin')} />
            </Button>
          </div>
        </div>
        {shouldShowOverride && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              Merge blocked: post-code tests not passing. Enable override to proceed.
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-foreground/80 cursor-pointer select-none">
              <Checkbox
                checked={Boolean(allowMergeWithoutTests)}
                onCheckedChange={(checked) => onAllowMergeWithoutTestsChange?.(checked === true)}
                className="border-warning/60 data-[state=checked]:border-warning"
              />
              Ignore missing/failed tests
            </label>
          </div>
        )}
        {postCodeTests ? (
          <div className="space-y-2 text-xs text-foreground/80">
            <div className="flex flex-wrap gap-3">
              {postCodeTests.summary && (
                <span>
                  {postCodeTests.summary.passed ?? 0}/{postCodeTests.summary.total ?? 0} passed
                </span>
              )}
              {postCodeTests.completed_at && (
                <span className="text-muted-foreground">
                  {formatRelativeTime(new Date(postCodeTests.completed_at))}
                </span>
              )}
            </div>
            {postCodeTests.results && postCodeTests.results.length > 0 ? (
              <div className="space-y-1">
                {postCodeTests.results.map((result) => (
                  <div key={result.command} className="flex items-center justify-between">
                    <span className="truncate">{result.command}</span>
                    <Badge variant={result.status === 'passed' ? 'success' : 'destructive'}>
                      {result.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : postCodeTests.test_plan && postCodeTests.test_plan.length > 0 ? (
              <div className="space-y-1">
                {postCodeTests.test_plan.map((command) => (
                  <div key={command} className="text-muted-foreground">
                    {command}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No test plan recorded.</p>
            )}
            {postCodeTests.reason && (
              <p className="text-muted-foreground">{postCodeTests.reason}</p>
            )}
            {failedResult && (failedResult.stderr || failedResult.stdout) && (
              <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] text-foreground/80 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Last failure output</p>
                {failedResult.stderr && (
                  <pre className="whitespace-pre-wrap text-destructive/80">{failedResult.stderr}</pre>
                )}
                {!failedResult.stderr && failedResult.stdout && (
                  <pre className="whitespace-pre-wrap">{failedResult.stdout}</pre>
                )}
              </div>
            )}
            {actionMessage && (
              <div className="text-xs text-success">{actionMessage}</div>
            )}
            {actionError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                {actionError}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">post_code_tests.json not found.</p>
        )}
      </div>

      <AlertDialog open={showFixConfirm} onOpenChange={setShowFixConfirm}>
        <AlertDialogContent className="sm:max-w-[540px] max-h-[80vh] overflow-hidden">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply post-code test fix?</AlertDialogTitle>
            <AlertDialogDescription>
              This will install missing backend/test dependencies inside the backend venv.
              No system-wide packages will be changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-xs text-foreground/80">
            <div className="flex items-start gap-2">
              <Checkbox
                id="upgrade-pip"
                checked={fixUpgradePip}
                onCheckedChange={(checked) => setFixUpgradePip(Boolean(checked))}
              />
              <label htmlFor="upgrade-pip" className="leading-5 text-muted-foreground">
                Also upgrade pip in the backend venv (recommended if you see a pip update notice)
              </label>
            </div>
            {failureDetail && (
              <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] text-foreground/80 space-y-1 max-h-[45vh] overflow-y-auto">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Detected failure</p>
                <pre className="whitespace-pre-wrap break-words">{failureDetail}</pre>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isFixingTests}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowFixConfirm(false);
                void handleFixPostCodeTests({ upgradePip: fixUpgradePip });
              }}
              disabled={isFixingTests}
            >
              {isFixingTests ? 'Fixing...' : 'Apply Fix'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
