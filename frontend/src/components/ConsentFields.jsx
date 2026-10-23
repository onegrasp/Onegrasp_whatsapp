// Consent checkbox plus the required "where did it come from" note.
export default function ConsentFields({
  consent,
  setConsent,
  source,
  setSource,
  label = "This person agreed to receive WhatsApp messages from us",
}) {
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" className="checkbox mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {label}
      </label>
      {consent && (
        <div className="mt-2 pl-6">
          <input
            aria-label="Where consent was given"
            className="input input-sm"
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Where? e.g. Website sign-up form, Webinar registration"
          />
        </div>
      )}
      <p className="mt-2 pl-6 text-xs text-gray-500">WhatsApp requires opt-in before you message someone first. Keep a record of where it came from.</p>
    </div>
  );
}
