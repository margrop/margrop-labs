import type { ComponentChildren } from "preact";

type FormFieldProps = {
  id: string;
  label: string;
  value: string;
  hint: string;
  children: ComponentChildren;
};

export function FormField({
  id,
  label,
  value,
  hint,
  children,
}: FormFieldProps) {
  return (
    <div class="form-field">
      <div class="form-field-heading">
        <label for={id}>{label}</label>
        <output aria-label={`${label}当前值`}>{value}</output>
      </div>
      <p id={`${id}-hint`} class="form-field-hint">
        {hint}
      </p>
      {children}
    </div>
  );
}
