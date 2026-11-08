import type { ReactNode } from "react";

export type SectionHeadingVariant = "split" | "stacked";

/** Reusable semantic header shared by settings modules and statistics panels. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  className = "",
  variant = "split",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
  variant?: SectionHeadingVariant;
}) {
  if (variant === "stacked") {
    return <header className={className}><span>{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</header>;
  }
  return (
    <header className={className}>
      <div><span>{eyebrow}</span><h2>{title}</h2></div>
      {description && <p>{description}</p>}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"lm-empty-state " + className} role="status">
      {icon && <span className="lm-empty-state-icon" aria-hidden="true">{icon}</span>}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
