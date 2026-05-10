import React from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";
import { useTranslation } from "react-i18next";

const defaultValue = "default";

export const MaxChatTurnsSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const options = [
    {
      value: "2",
      label: t("ai.maxChatTurnsEconomyLabel"),
      description: t("ai.maxChatTurnsEconomyDescription"),
    },
    {
      value: defaultValue,
      label: t("ai.maxChatTurnsDefaultLabel", { count: MAX_CHAT_TURNS_IN_CONTEXT }),
      description: t("ai.maxChatTurnsDefaultDescription"),
    },
    {
      value: "5",
      label: t("ai.maxChatTurnsPlusLabel"),
      description: t("ai.maxChatTurnsPlusDescription"),
    },
    {
      value: "10",
      label: t("ai.maxChatTurnsHighLabel"),
      description: t("ai.maxChatTurnsHighDescription"),
    },
    {
      value: "100",
      label: t("ai.maxChatTurnsMaxLabel"),
      description: t("ai.maxChatTurnsMaxDescription"),
    },
  ];

  const handleValueChange = (value: string) => {
    if (value === "default") {
      updateSettings({ maxChatTurnsInContext: undefined });
    } else {
      const numValue = parseInt(value, 10);
      updateSettings({ maxChatTurnsInContext: numValue });
    }
  };

  const currentValue =
    settings?.maxChatTurnsInContext?.toString() || defaultValue;
  const currentOption =
    options.find((opt) => opt.value === currentValue) || options[1];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <label
          htmlFor="max-chat-turns"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.maxChatTurns")}
        </label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="max-chat-turns">
            <SelectValue placeholder={t("ai.selectMaxChatTurns")} />
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
