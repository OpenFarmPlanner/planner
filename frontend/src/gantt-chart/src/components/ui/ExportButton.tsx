import React from "react";
import type { ExportOptions, ExportFormat } from "../../types";

/**
 * Props for ExportButton component
 */
export interface ExportButtonProps {
  /**
   * Export function to call when button is clicked.
   * Resolves with the exporter-specific result after the export has finished.
   */
  onExport: (
    filename?: string,
    options?: Omit<ExportOptions, "format" | "filename">,
  ) => Promise<unknown>;

  /**
   * Export format
   * @default 'png'
   */
  format?: ExportFormat;

  /**
   * Filename for export (without extension)
   * @default 'gantt-chart'
   */
  filename?: string;

  /**
   * Button label
   */
  label?: string;

  /**
   * Button icon (emoji or component)
   */
  icon?: React.ReactNode;

  /**
   * Custom className
   */
  className?: string;

  /**
   * Custom styles
   */
  style?: React.CSSProperties;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Loading state
   */
  loading?: boolean;

  /**
   * Additional export options
   */
  exportOptions?: Omit<ExportOptions, "format" | "filename">;

  /**
   * Variant style
   * @default 'primary'
   */
  variant?: "primary" | "secondary" | "outline" | "ghost";

  /**
   * Size
   * @default 'medium'
   */
  size?: "small" | "medium" | "large";
}

/**
 * ExportButton Component
 * A customizable button for exporting Gantt charts
 *
 * @example
 * ```tsx
 * import { ExportButton, useGanttExport } from 'react-modern-gantt';
 *
 * function MyComponent() {
 *   const { ganttRef, exportAsPng } = useGanttExport();
 *
 *   return (
 *     <>
 *       <GanttChart ref={ganttRef} tasks={tasks} />
 *       <ExportButton
 *         onExport={exportAsPng}
 *         format="png"
 *         label="Export PNG"
 *         icon="📥"
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export const ExportButton: React.FC<ExportButtonProps> = ({
  onExport,
  format = "png",
  filename = "gantt-chart",
  label,
  icon,
  className = "",
  style,
  disabled = false,
  loading = false,
  exportOptions,
  variant = "primary",
  size = "medium",
}) => {
  const [isExporting, setIsExporting] = React.useState(false);

  const handleExport = async (): Promise<void> => {
    if (disabled || isExporting || loading) return;

    setIsExporting(true);
    try {
      await onExport(filename, {
        ...exportOptions,
      });
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setIsExporting(false);
    }
  };

  // Generate default label if not provided
  const buttonLabel = label || `Export ${format.toUpperCase()}`;

  // Generate default icon if not provided
  const buttonIcon =
    icon || (format === "pdf" ? "📄" : format === "jpeg" ? "🖼️" : "📥");

  // Variant styles
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: "#3b82f6",
      color: "#ffffff",
      border: "none",
    },
    secondary: {
      backgroundColor: "#6b7280",
      color: "#ffffff",
      border: "none",
    },
    outline: {
      backgroundColor: "transparent",
      color: "#3b82f6",
      border: "1px solid #3b82f6",
    },
    ghost: {
      backgroundColor: "transparent",
      color: "#374151",
      border: "none",
    },
  };

  // Size styles
  const sizeStyles: Record<string, React.CSSProperties> = {
    small: {
      padding: "4px 12px",
      fontSize: "0.75rem",
    },
    medium: {
      padding: "8px 16px",
      fontSize: "0.875rem",
    },
    large: {
      padding: "12px 24px",
      fontSize: "1rem",
    },
  };

  const buttonStyles: React.CSSProperties = {
    ...variantStyles[variant],
    ...sizeStyles[size],
    borderRadius: "6px",
    fontWeight: 500,
    cursor: disabled || isExporting || loading ? "not-allowed" : "pointer",
    opacity: disabled || isExporting || loading ? 0.6 : 1,
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.2s ease",
    ...style,
  };

  return (
    <button
      className={`rmg-export-button ${className}`}
      style={buttonStyles}
      onClick={handleExport}
      disabled={disabled || isExporting || loading}
      data-rmg-component="export-button"
      data-format={format}
    >
      {isExporting || loading ? (
        <>
          <span style={{ animation: "spin 1s linear infinite" }}>⏳</span>
          <span>Exporting...</span>
        </>
      ) : (
        <>
          {buttonIcon && <span>{buttonIcon}</span>}
          <span>{buttonLabel}</span>
        </>
      )}
    </button>
  );
};

export default ExportButton;
