import React from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

const defaultValue = "medium";

export const ThinkingBudgetSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const options = [
    {
      value: "low",
      label: t("ai.thinkingBudgetLowLabel"),
      description: t("ai.thinkingBudgetLowDescription"),
    },
    {
      value: defaultValue,
      label: t("ai.thinkingBudgetMediumLabel"),
      description: t("ai.thinkingBudgetMediumDescription"),
    },
    {
      value: "high",
      label: t("ai.thinkingBudgetHighLabel"),
      description: t("ai.thinkingBudgetHighDescription"),
    },
  ];

  const handleValueChange = (value: string) => {
    updateSettings({ thinkingBudget: value as "low" | "medium" | "high" });
  };

  const currentValue = settings?.thinkingBudget || defaultValue;
  const currentOption =
    options.find((opt) => opt.value === currentValue) || options[1];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <label
          htmlFor="thinking-budget"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.thinkingBudget")}
        </label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="thinking-budget">
            <SelectValue placeholder={t("ai.selectThinkingBudget")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {currentOption.description}
      </div>
    </div>
  );
};
