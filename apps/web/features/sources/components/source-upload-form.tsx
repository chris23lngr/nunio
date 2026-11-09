import type { FormEventHandler } from "react";

export function SourceUploadForm({
  onSubmit,
  disabled,
  uploading,
}: {
  onSubmit: FormEventHandler<HTMLFormElement>;
  disabled: boolean;
  uploading: boolean;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        PDF{" "}
        <input
          name="source"
          type="file"
          accept="application/pdf,.pdf"
          required
          disabled={disabled}
        />
      </label>
      <button type="submit" disabled={disabled}>
        {uploading ? "Uploading PDF…" : "Upload PDF"}
      </button>
    </form>
  );
}
