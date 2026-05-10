import React from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_MAX_TOOL_CALL_STEPS } from "@/constants/settings_constants";
import { useTranslation } from "react-i18next";

const defaultValue = "default";

export const MaxToolCallStepsSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const options = [
    {
      value: "25",
      label: t("ai.maxToolCallStepsLowLabel"),
      description: t("ai.maxToolCallStepsLowDescription"),
    },
    {
      value: "50",
      label: t("ai.maxToolCallStepsMediumLabel"),
      description: t("ai.maxToolCallStepsMediumDescription"),
    },
    {
      value: defaultValue,
      label: t("ai.maxToolCallStepsDefaultLabel", { count: DEFAULT_MAX_TOOL_CALL_STEPS }),
      description: t("ai.maxToolCallStepsDefaultDescription"),
    },
    {
      value: "200",
      label: t("ai.maxToolCallStepsHighLabel"),
      description: t("ai.maxToolCallStepsHighDescription"),
    },
  ];

  const handleValueChange = (value: string) => {
    if (value === "default") {
      updateSettings({ maxToolCallSteps: undefined });
    } else {
      const numValue = parseInt(value, 10);
      updateSettings({ maxToolCallSteps: numValue });
    }
  };

  const rawValue = settings?.maxToolCallSteps;
  const currentValue =
    rawValue == null || rawValue === DEFAULT_MAX_TOOL_CALL_STEPS
      ? defaultValue
      : rawValue.toString();

  const currentOption =
    options.find((opt) => opt.value === currentValue) ||
    options.find((opt) => opt.value === defaultValue) ||
    options[0];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <label
          htmlFor="max-tool-call-steps"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.maxToolCallSteps")}
        </label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="max-tool-call-steps">
            <SelectValue placeholder={t("ai.selectMaxToolCallSteps")} />
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
