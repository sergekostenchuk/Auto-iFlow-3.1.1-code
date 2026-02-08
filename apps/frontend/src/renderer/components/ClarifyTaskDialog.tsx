import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Checkbox } from './ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import type { ClarifyingQuestion, ClarifyAnswers } from '../../shared/types';

interface ClarifyTaskDialogProps {
  open: boolean;
  questions: ClarifyingQuestion[];
  iteration: number;
  maxIterations: number;
  onSubmit: (answers: ClarifyAnswers) => void;
  onCollectContext?: () => void;
  onClose: () => void;
}

export function ClarifyTaskDialog({
  open,
  questions,
  iteration,
  maxIterations,
  onSubmit,
  onCollectContext,
  onClose
}: ClarifyTaskDialogProps) {
  const { t } = useTranslation('tasks');
  const [answers, setAnswers] = useState<ClarifyAnswers>({});

  useEffect(() => {
    if (!open) return;
    setAnswers({});
  }, [open, questions]);

  const canSubmit = useMemo(() => {
    const isAnswered = (question: ClarifyingQuestion) => {
      const value = answers[question.id];
      if (question.type === 'multi_select') {
        return Array.isArray(value) && value.length > 0;
      }
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }
      return false;
    };

    const requiredQuestions = questions.filter((question) => question.required !== false);
    const requiredComplete = requiredQuestions.every(isAnswered);
    const hasAnyAnswer = questions.some(isAnswered);

    return requiredComplete && hasAnyAnswer;
  }, [answers, questions]);

  const handleToggleOption = (questionId: string, option: string) => {
    const current = answers[questionId];
    const next = Array.isArray(current) ? current : [];
    if (next.includes(option)) {
      setAnswers((prev) => ({
        ...prev,
        [questionId]: next.filter((value) => value !== option)
      }));
      return;
    }
    setAnswers((prev) => ({
      ...prev,
      [questionId]: [...next, option]
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('wizard.intake.clarifyTitle')}</DialogTitle>
          <DialogDescription>
            {t('wizard.intake.clarifySubtitle')}
          </DialogDescription>
          <div className="text-xs text-muted-foreground">
            {t('wizard.intake.iterationLabel', { current: iteration + 1, max: maxIterations })}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {questions.map((question) => (
            <div key={question.id} className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {question.question}
              </div>
              {question.type === 'text' && (
                <Input
                  value={(answers[question.id] as string) || ''}
                  onChange={(event) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [question.id]: event.target.value
                    }))
                  }
                  placeholder={t('wizard.intake.answerPlaceholder')}
                />
              )}
              {question.type === 'single_select' && (
                <Select
                  value={(answers[question.id] as string) || ''}
                  onValueChange={(value) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [question.id]: value
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('wizard.intake.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(question.options || []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {question.type === 'multi_select' && (
                <div className="space-y-2">
                  {(question.options || []).map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(option)}
                        onCheckedChange={() => handleToggleOption(question.id, option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>
            {t('wizard.intake.cancelClarify')}
          </Button>
          {onCollectContext && (
            <Button variant="secondary" onClick={onCollectContext}>
              {t('wizard.intake.collectContext')}
            </Button>
          )}
          <Button onClick={() => onSubmit(answers)} disabled={!canSubmit}>
            {t('wizard.intake.submitClarify')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
