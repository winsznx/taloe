"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, SVGProps } from "react";

const NAV_LINKS = [
  { href: "/app", label: "New request", icon: PlusCircleIcon },
  { href: "/activity", label: "Activity", icon: ClockIcon },
  { href: "/about/how-it-works", label: "How it works", icon: InfoIcon },
] as const;

/**
 * Client component only because active-link state needs the current
 * pathname — the rest of the dashboard shell stays a server component.
 */
export function SidebarNav(): ReactNode {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard">
      <ul className="sidebar-nav">
        {NAV_LINKS.map((link) => {
          const active = pathname === link.href || (link.href !== "/app" && pathname?.startsWith(link.href));
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link href={link.href} className="sidebar-link" aria-current={active ? "page" : undefined}>
                <Icon className="sidebar-icon" aria-hidden="true" />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function iconProps(props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...props,
  };
}

function PlusCircleIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg {...iconProps(props)}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.75v6.5M6.75 10h6.5" />
    </svg>
  );
}

function ClockIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg {...iconProps(props)}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 5.75V10l3 2" />
    </svg>
  );
}

function InfoIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg {...iconProps(props)}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9.25v4M10 6.75v.01" />
    </svg>
  );
}
