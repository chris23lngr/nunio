"use client";

import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

function TextField({ label, ...props }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "defaultValue" | "onChange" | "onBlur">) {
  const field = useFieldContext<string>();
  const id = useId();
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <>
      <label>
        {label}{" "}
        <input {...props} name={field.name} value={field.state.value}
          onChange={event => field.handleChange(event.target.value)} onBlur={field.handleBlur}
          aria-invalid={invalid || undefined} aria-describedby={invalid ? id : props["aria-describedby"]} />
      </label>
      {invalid && <p id={id} role="alert">{field.state.meta.errors.join(" ")}</p>}
    </>
  );
}

function SubmitButton({ children, disabled, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={state => [state.canSubmit, state.isSubmitting]}>
      {([canSubmit, isSubmitting]) => <button {...props} type="submit" disabled={disabled || !canSubmit || isSubmitting}>{children}</button>}
    </form.Subscribe>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
  formComponents: { SubmitButton },
});
