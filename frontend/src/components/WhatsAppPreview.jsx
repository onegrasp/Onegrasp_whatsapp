import { ExternalLink, Image as ImageIcon, Phone, Reply } from "lucide-react";
import { formatTime } from "../lib/format";

const LINK = /^(https?:\/\/|www\.)\S+/;

// Message text with links highlighted the way WhatsApp shows them.
function FormattedBody({ text }) {
  if (!text) return <span className="italic text-gray-400">Message text appears here</span>;
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {line.split(/(\s+)/).map((part, j) =>
        LINK.test(part) ? (
          <span key={j} className="text-[#027eb5] underline">
            {part}
          </span>
        ) : (
          part
        )
      )}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

const BUTTON_ICON = { URL: ExternalLink, phone: Phone };

/**
 * Approximation of how a business message renders in WhatsApp. It reflects
 * what is saved in this app — WhatsApp always delivers the approved version.
 */
export default function WhatsAppPreview({
  body,
  headerImageUrl,
  showImageSlot = false,
  buttons = [],
  imageRatio,
  onImageClick,
  variant = "mobile",
  size = "md",
}) {
  const web = variant === "web";
  const large = size === "lg";

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-[#efeae2]">
      <div className={`flex shrink-0 items-center gap-2.5 px-3 py-2.5 ${web ? "border-b border-gray-200 bg-[#f0f2f5] text-gray-900" : "bg-[#008069] text-white"}`}>
        <div className={`grid h-7 w-7 place-items-center rounded-full text-2xs font-semibold ${web ? "bg-brand-100 text-brand-800" : "bg-white/20"}`} aria-hidden="true">
          OG
        </div>
        <div className="leading-tight">
          <p className="text-13 font-medium">OneGrasp</p>
          <p className={`text-2xs ${web ? "text-gray-500" : "text-white/80"}`}>Business account</p>
        </div>
      </div>

      <div className={`flex flex-1 flex-col justify-end ${large ? "min-h-[380px] p-6" : "min-h-[220px] p-3"}`}>
        <div className={`ml-auto w-full overflow-hidden rounded-lg rounded-tr-none bg-white shadow-xs ${web ? "max-w-[520px]" : large ? "max-w-[360px]" : "max-w-[300px]"}`}>
          {headerImageUrl ? (
            <button
              type="button"
              onClick={onImageClick}
              disabled={!onImageClick}
              className="block w-full bg-gray-100 disabled:cursor-default"
              style={imageRatio ? { aspectRatio: String(imageRatio) } : undefined}
              aria-label="View header image"
            >
              <img src={headerImageUrl} alt="" className="h-full max-h-80 w-full object-contain" />
            </button>
          ) : (
            showImageSlot && (
              <div className="flex h-32 flex-col items-center justify-center gap-1 bg-gray-100 text-gray-400">
                <ImageIcon size={22} aria-hidden="true" />
                <span className="text-2xs">Header image</span>
              </div>
            )
          )}

          <div className="px-2.5 pb-1.5 pt-2">
            <p className={`whitespace-pre-wrap wrap-break-word leading-relaxed text-gray-900 ${large ? "text-sm" : "text-13"}`}>
              <FormattedBody text={body} />
            </p>
            <p className="mt-0.5 text-right text-2xs text-gray-400">{formatTime(new Date())}</p>
          </div>

          {buttons.length > 0 && (
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {buttons.map((btn, i) => {
                const Icon = BUTTON_ICON[btn.type] || Reply;
                return (
                  <div key={i} className="flex items-center justify-center gap-1.5 py-2 text-13 font-medium text-[#00a884]">
                    <Icon size={13} aria-hidden="true" />
                    {btn.text}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
