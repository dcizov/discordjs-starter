"use client";
import { createContext } from "react";

/**
 * Label/hint wiring shared by every form control.
 *
 * `Field` provides it; `Input`, `Textarea`, `NativeSelect`, `FormSelect` and
 * `Combobox` read it, so a control inside a `Field` never needs a hand-written
 * `aria-label` and can never drift from its visible label.
 */
export const FieldContext = createContext<{
  label: string;
  id: string;
  hintId?: string;
} | null>(null);
