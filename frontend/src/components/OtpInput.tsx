import React, { useRef, useState, KeyboardEvent, ClipboardEvent } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function OtpInput({ length = 6, value, onChange, disabled = false }: OtpInputProps) {
  const [activeInput, setActiveInput] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const getOtpValue = () => {
    const val = value ? value.toString() : '';
    return val.padEnd(length, ' ').split('');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const val = e.target.value;
    if (!/^[0-9]*$/.test(val)) return; // Allow only numbers

    const otpArray = getOtpValue();
    otpArray[index] = val.slice(-1); // Take last entered character if multiple

    // Convert array back to string, trimming trailing spaces
    const newOtp = otpArray.join('').trim();
    onChange(newOtp);

    // Move to next input if there's a value
    if (val && index < length - 1) {
      setActiveInput(index + 1);
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const otpArray = getOtpValue();

      if (otpArray[index] !== ' ') {
        // Clear current box
        otpArray[index] = ' ';
        onChange(otpArray.join('').trim());
      } else if (index > 0) {
        // Move to previous box and clear it
        otpArray[index - 1] = ' ';
        onChange(otpArray.join('').trim());
        setActiveInput(index - 1);
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      setActiveInput(index - 1);
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      setActiveInput(index + 1);
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain').slice(0, length);
    if (!/^[0-9]+$/.test(pastedData)) return; // Only paste numbers

    onChange(pastedData);

    // Focus next empty input or last input
    const nextIndex = Math.min(pastedData.length, length - 1);
    setActiveInput(nextIndex);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleFocus = (index: number) => {
    setActiveInput(index);
    // Move cursor to the end
    setTimeout(() => {
      inputRefs.current[index]?.setSelectionRange(1, 1);
    }, 0);
  };

  const otpArray = getOtpValue();

  return (
    <div className="flex justify-between items-center gap-2">
      {otpArray.map((digit, index) => (
        <input
          key={`otp-${index}`}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit === ' ' ? '' : digit}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          disabled={disabled}
          className={`w-12 h-14 text-center text-xl font-bold bg-[#0B0F1A] border ${
            activeInput === index
              ? 'border-[#7C5CFF] ring-1 ring-[#7C5CFF] shadow-glow-primary'
              : 'border-[#1A2235]'
          } rounded-lg text-slate-200 focus:outline-none transition-all duration-200 disabled:opacity-50`}
        />
      ))}
    </div>
  );
}
