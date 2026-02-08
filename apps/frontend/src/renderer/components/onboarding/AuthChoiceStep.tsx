import { useState, useEffect } from 'react';
import { LogIn, Key, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';

interface AuthChoiceStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onAPIKeyPathComplete?: () => void; // Called when profile is created (skips oauth)
}

interface AuthOptionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  variant?: 'default' | 'oauth';
  'data-testid'?: string;
}

function AuthOptionCard({ icon, title, description, onClick, variant = 'default', 'data-testid': dataTestId }: AuthOptionCardProps) {
  return (
    <Card
      data-testid={dataTestId}
      className={`border border-border bg-card/50 backdrop-blur-sm cursor-pointer transition-all hover:border-primary/50 hover:shadow-md ${
        variant === 'oauth' ? 'hover:bg-accent/5' : ''
      }`}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground text-lg">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * AuthChoiceStep component for the onboarding wizard.
 *
 * Allows new users to choose between:
 * 1. Web login (Sign in via iFlow CLI)
 * 2. API key authentication (Use iFlow API key)
 *
 * Features:
 * - Two equal-weight authentication options
 * - Skip button for users who want to configure later
 * - API key path saves global iFlow API key
 * - Web login path proceeds to OAuthStep
 *
 * AC Coverage:
 * - AC1: Displays first-run screen with two clear options
 */
export function AuthChoiceStep({ onNext, onBack, onSkip, onAPIKeyPathComplete }: AuthChoiceStepProps) {
  const settings = useSettingsStore((state) => state.settings);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  // OAuth button handler - proceeds to OAuth step
  const handleOAuthChoice = () => {
    onNext();
  };

  // API Key button handler - opens API key dialog
  const handleAPIKeyChoice = () => {
    setIsApiKeyDialogOpen(true);
  };

  const handleCloseApiKeyDialog = () => {
    if (!isSavingApiKey) {
      setIsApiKeyDialogOpen(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setApiKeyError('Please enter an API key.');
      return;
    }

    setIsSavingApiKey(true);
    setApiKeyError(null);

    try {
      const saved = await saveSettings({ globalIflowApiKey: apiKey.trim() });
      if (!saved) {
        setApiKeyError('Failed to save API key. Please try again.');
        return;
      }

      setIsApiKeyDialogOpen(false);
      onAPIKeyPathComplete?.();
    } finally {
      setIsSavingApiKey(false);
    }
  };

  useEffect(() => {
    if (isApiKeyDialogOpen) {
      setApiKey(settings.globalIflowApiKey || '');
      setApiKeyError(null);
    }
  }, [isApiKeyDialogOpen, settings.globalIflowApiKey]);

  return (
    <>
      <div className="flex h-full flex-col items-center justify-center px-8 py-6">
        <div className="w-full max-w-2xl">
          {/* Hero Section */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Shield className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">
              Choose Your Authentication Method
            </h1>
            <p className="mt-3 text-muted-foreground text-lg">
              Select how you want to authenticate with iFlow. You can change this later in Settings.
            </p>
          </div>

          {/* Authentication Options - Equal Visual Weight */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <AuthOptionCard
              icon={<LogIn className="h-6 w-6" />}
              title="Sign in via iFlow"
              description="Use the iFlow CLI to authenticate in your browser. Simple and secure web login."
              onClick={handleOAuthChoice}
              variant="oauth"
              data-testid="auth-option-oauth"
            />
            <AuthOptionCard
              icon={<Key className="h-6 w-6" />}
              title="Use API Key"
              description="Paste an iFlow API key or a compatible API provider key. You can change this later."
              onClick={handleAPIKeyChoice}
              data-testid="auth-option-apikey"
            />
          </div>

          {/* Info text */}
          <div className="text-center mb-8">
            <p className="text-muted-foreground text-sm">
              Both options provide full access to iFlow features. Choose based on your preference.
            </p>
          </div>

          {/* Skip Button */}
          <div className="flex justify-center">
            <Button
              size="lg"
              variant="ghost"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={isApiKeyDialogOpen} onOpenChange={handleCloseApiKeyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enter iFlow API Key</DialogTitle>
            <DialogDescription>
              Your key is stored in Settings &gt; Integrations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="iflow-api-key">API Key</Label>
            <Input
              id="iflow-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="iflow-..."
              disabled={isSavingApiKey}
            />
            {apiKeyError && (
              <p className="text-xs text-destructive">{apiKeyError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseApiKeyDialog} disabled={isSavingApiKey}>
              Cancel
            </Button>
            <Button onClick={handleSaveApiKey} disabled={isSavingApiKey}>
              {isSavingApiKey ? 'Saving...' : 'Save API Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
