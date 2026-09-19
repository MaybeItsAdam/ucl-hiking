"use client";

import React, { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string | number;
  icon?: React.ReactNode;
  color?: string; // e.g. "#10b981", "#f59e0b", "#ef4444"
  description?: string;
}

export interface CustomSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  icon?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  variant?: "pill" | "input"; // 'pill' for search/filter bars, 'input' for modal forms
  width?: string | number;
  dropdownAlign?: "left" | "right";
}

export function CustomSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  icon,
  ariaLabel,
  className = "",
  disabled = false,
  variant = "pill",
  width,
  dropdownAlign = "left",
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOption = options.find((opt) => opt.value === value);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else if (e.key === "ArrowDown") {
        const currentIndex = options.findIndex((opt) => opt.value === value);
        const nextIndex = (currentIndex + 1) % options.length;
        onChange(options[nextIndex].value);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (isOpen) {
        const currentIndex = options.findIndex((opt) => opt.value === value);
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        onChange(options[prevIndex].value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleSelect = (optionValue: T) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const isPill = variant === "pill";

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${isPill ? "is-pill" : "is-input"} ${className}`}
      style={{
        position: "relative",
        display: "inline-block",
        width: width || (isPill ? "auto" : "100%"),
        userSelect: "none",
      }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={ariaLabel || selectedOption?.label || placeholder}
        className={`custom-select-trigger ${isOpen ? "is-open" : ""}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: isPill ? "8px" : "10px",
          width: "100%",
          padding: isPill ? "8px 14px" : "10px 14px",
          borderRadius: isPill ? "999px" : "8px",
          border: isOpen
            ? "1px solid var(--primary, #500778)"
            : "1px solid var(--line, #e2e8f0)",
          background: disabled ? "var(--surface-2)" : "var(--surface)",
          color: selectedOption ? "var(--foreground, #0f172a)" : "var(--muted)",
          fontSize: "13px",
          fontWeight: isPill ? 700 : 600,
          cursor: disabled ? "not-allowed" : "pointer",
          outline: "none",
          transition: "all 0.15s ease",
          boxShadow: isOpen
            ? "0 0 0 3px rgba(80, 7, 120, 0.12)"
            : "0 1px 2px rgba(0, 0, 0, 0.04)",
          textAlign: "left",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {icon && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                opacity: 0.7,
                color: isOpen ? "var(--primary, #500778)" : "inherit",
              }}
            >
              {icon}
            </span>
          )}

          {selectedOption?.color && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: selectedOption.color,
                flexShrink: 0,
                boxShadow: `0 0 0 2px ${selectedOption.color}20`,
              }}
            />
          )}

          {selectedOption?.icon && (
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              {selectedOption.icon}
            </span>
          )}

          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>

          {selectedOption?.badge !== undefined && (
            <span
              className="custom-select-badge"
              style={{
                fontSize: "11px",
                fontWeight: 800,
                padding: "1px 6px",
                borderRadius: "999px",
                background: "var(--surface-2)",
                color: "var(--muted)",
                marginLeft: 2,
              }}
            >
              {selectedOption.badge}
            </span>
          )}
        </span>

        <ChevronDown
          size={14}
          style={{
            opacity: 0.6,
            flexShrink: 0,
            marginLeft: 4,
            transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Floating Dropdown List */}
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          className="custom-select-menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            [dropdownAlign === "right" ? "right" : "left"]: 0,
            minWidth: isPill ? "200px" : "100%",
            maxWidth: "320px",
            maxHeight: "280px",
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--line, #e2e8f0)",
            borderRadius: "12px",
            padding: "6px",
            boxShadow:
              "0 12px 30px -4px rgba(0, 0, 0, 0.14), 0 4px 10px -2px rgba(0, 0, 0, 0.06)",
            zIndex: 100,
            animation: "selectMenuFade 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
            boxSizing: "border-box",
          }}
        >
          {options.map((option) => {
            const isSelected = option.value === value;

            return (
              <div
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(option.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: isSelected ? 700 : 500,
                  color: isSelected
                    ? "var(--primary, #500778)"
                    : "var(--foreground, #1e293b)",
                  background: isSelected ? "var(--info-bg)" : "transparent",
                  cursor: "pointer",
                  transition: "background 0.12s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "var(--surface-2)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    overflow: "hidden",
                  }}
                >
                  {option.color && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: option.color,
                        flexShrink: 0,
                      }}
                    />
                  )}

                  {option.icon && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        opacity: 0.8,
                      }}
                    >
                      {option.icon}
                    </span>
                  )}

                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {option.label}
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    flexShrink: 0,
                  }}
                >
                  {option.badge !== undefined && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: "999px",
                        background: isSelected ? "rgba(80, 7, 120, 0.12)" : "var(--surface-2)",
                        color: isSelected ? "var(--primary, #500778)" : "var(--muted)",
                      }}
                    >
                      {option.badge}
                    </span>
                  )}

                  {isSelected && (
                    <Check
                      size={14}
                      style={{
                        color: "var(--primary, #500778)",
                        strokeWidth: 2.5,
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
