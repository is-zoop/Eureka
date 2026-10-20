"use client";
import type { ComponentProps } from "react";
import { useI18n } from "@/hooks/useI18n";
import { UserInputCard } from "./UserInputCard";

/** Compatibility wrapper for historical and current planning questions. */
export function PlanQuestionCard(props: ComponentProps<typeof UserInputCard>) {
  const { t } = useI18n();
  return <UserInputCard {...props} title={t("plan.question")} />;
}
