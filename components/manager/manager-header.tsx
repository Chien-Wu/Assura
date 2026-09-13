"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AudioLines,
  CalendarDays,
  ClipboardCheck,
  Menu,
  Users,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import AccountMenu from "../layout/account-menu";
import "./manager-header.css";

const sections = [
  { id: "shifts", label: "Shifts", icon: CalendarDays },
  { id: "participants", label: "Participants", icon: Users },
  { id: "review", label: "Review", icon: ClipboardCheck },
] as const;

export type ManagerSection = (typeof sections)[number]["id"];
export type ManagerAccount = {
  name: string;
  providerName: string;
  providers: { id: string; name: string }[];
};

export default function ManagerHeader({
  account,
  providerId,
  section,
  onSectionChange,
}: {
  account: ManagerAccount;
  providerId: string;
  section: ManagerSection;
  onSectionChange: (section: ManagerSection) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="topbar manager-topbar">
      <div className="manager-brand-group">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="manager-nav-trigger"
              aria-label="Open management menu"
              title="Management menu"
            >
              <Menu size={22} aria-hidden="true" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="manager-drawer">
            <SheetHeader className="manager-drawer-heading">
              <SheetTitle>Management</SheetTitle>
              <SheetDescription>{account.providerName}</SheetDescription>
            </SheetHeader>
            <nav className="manager-navigation" aria-label="Manager workspace">
              {sections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => {
                    onSectionChange(id);
                    setOpen(false);
                  }}
                >
                  <Icon size={20} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
        <Link className="brand" href="/">
          <span className="brand-icon">
            <AudioLines size={24} aria-hidden="true" />
          </span>
          <span>LegalMate</span>
          <span className="edition">MANAGER</span>
        </Link>
      </div>
      <span className="manager-role">{account.providerName}</span>
      <AccountMenu
        name={account.name}
        role="manager"
        providerName={account.providerName}
        providers={account.providers}
        providerId={providerId}
      />
    </header>
  );
}
