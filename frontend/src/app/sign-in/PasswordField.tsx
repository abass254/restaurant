"use client";

import { useState } from "react";

type Props = {
  disabled?: boolean;
  defaultValue?: string;
  autoComplete?: string;
  minLength?: number;
  id?: string;
  label?: string | null;
  name?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  showValidCheck?: boolean;
};

export default function PasswordField({
  disabled,
  defaultValue = "",
  autoComplete = "current-password",
  minLength,
  id = "login-password",
  label = "Password",
  name = "password",
  placeholder = "Password",
  value,
  onChange,
  showValidCheck = false,
}: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const current = value ?? defaultValue;
  const looksValid = showValidCheck && String(current).length >= (minLength ?? 8);

  return (
    <div className="auth-split__field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <div
        className={`auth-split__input-wrap${looksValid ? " auth-split__input-wrap--checked" : ""}`}
      >
        <input
          id={id}
          name={name}
          type={showPassword ? "text" : "password"}
          required
          autoComplete={autoComplete}
          defaultValue={value === undefined ? defaultValue : undefined}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
          disabled={disabled}
          minLength={minLength}
          className="auth-split__input"
        />
        {looksValid ? (
          <span className="auth-split__check" aria-hidden="true">
            <i className="fas fa-check" />
          </span>
        ) : null}
        <button
          type="button"
          className="auth-split__toggle"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          <i
            className={`fas ${showPassword ? "fa-eye-slash" : "fa-eye"}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
