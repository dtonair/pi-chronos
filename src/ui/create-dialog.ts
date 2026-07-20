export interface CreateDialogValues {
  name: string;
  prompt: string;
  schedule: unknown;
}
export function validateCreateDialog(values: CreateDialogValues): boolean {
  return (
    values.name.trim().length > 0 &&
    values.prompt.trim().length > 0 &&
    values.schedule !== undefined
  );
}
