"use client";
import { forwardRef } from "react";
import { kzNationalDigits, maskKzNational } from "@/lib/payments/phone";

/**
 * Kazakhstan phone field: a fixed "+7" prefix and a masked "701 555 12 34" part.
 * Typing, deleting and pasting ("+7 701…", "8 701…", "701…") all land in the same format.
 * The value given to onChange is "+7 701 555 12 34" (or "" when empty).
 */
export const KzPhoneInput = forwardRef<HTMLInputElement, {
  value: string; onChange: (v: string) => void; name?: string; required?: boolean; invalid?: boolean;
  className?: string; inputClassName?: string; ariaLabel?: string;
}>(function KzPhoneInput({ value, onChange, name, required, invalid, className = "", inputClassName = "", ariaLabel }, ref) {
  const national = kzNationalDigits(value);
  return (
    <div className={`flex items-center overflow-hidden ${className}`}>
      <span className="select-none pl-4 pr-1.5 font-semibold text-ink" aria-hidden>+7</span>
      <input
        ref={ref}
        type="tel" inputMode="numeric" autoComplete="tel-national" required={required}
        aria-label={ariaLabel} aria-invalid={invalid || undefined}
        placeholder="700 123 45 67"
        value={maskKzNational(national)}
        onChange={(e) => {
          // Already complete: extra keystrokes are ignored (they would shift the number).
          if (national.length === 10 && e.target.value.replace(/\D/g, "").length > 10) return;
          let n = kzNationalDigits(e.target.value);
          // Backspace over a space: the digits did not change, so drop the digit before it.
          if (n === national && e.target.value.length < maskKzNational(national).length) n = n.slice(0, -1);
          onChange(n ? `+7 ${maskKzNational(n)}` : "");
        }}
        onPaste={(e) => {
          const n = kzNationalDigits(e.clipboardData.getData("text"));
          if (n) { e.preventDefault(); onChange(`+7 ${maskKzNational(n)}`); }
        }}
        className={`h-full min-w-0 flex-1 bg-transparent pr-4 tracking-wide text-ink outline-none placeholder:text-muted/60 ${inputClassName}`}
      />
      {name && <input type="hidden" name={name} value={national ? `+7${national}` : ""} />}
    </div>
  );
});
