"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  confirmAction,
  extractErrorMessage,
  showError,
  toastSuccess,
} from "@/lib/alerts";
import { apiRoutes } from "@/lib/config";
import {
  MERCHANT_SECTION_LABELS,
  TRANS_CHAP_DEFAULT_STAFF_SECTIONS,
  TRANS_CHAP_SECTION_LABELS,
  TRANS_CHAP_STAFF_SECTIONS,
  clampToTransChapSections,
} from "@/lib/merchant-permissions";
import type {
  MerchantSectionOption,
  StaffActionResponse,
  StaffListResponse,
  StaffPasswordResponse,
  StaffUser,
  UserInviteLookupResult,
} from "@/lib/types";
import { generateTempPassword } from "@/lib/temp-password";
import {
  EMPTY_INVITE_LOOKUP,
  inviteLookupIsExisting,
  inviteLookupReady,
  UserInviteEmailLookup,
  type UserInviteLookupState,
} from "@/components/app/UserInviteEmailLookup";

type TeamView = "list" | "create" | "edit" | "password" | "credentials";
type CreateMode = "invite" | "create";

type CreateForm = {
  name: string;
  email: string;
  phone: string;
  password: string;
  allowed_sections: string[];
  send_reset_email: boolean;
  auto_generate_password: boolean;
  require_change_password: boolean;
};

type CreatedCredentials = {
  name: string;
  email: string;
  password: string;
};

type EditForm = {
  name: string;
  phone: string;
  is_activated: boolean;
  allowed_sections: string[];
};

function emptyCreateForm(): CreateForm {
  return {
    name: "",
    email: "",
    phone: "",
    password: "",
    allowed_sections: [...TRANS_CHAP_DEFAULT_STAFF_SECTIONS],
    send_reset_email: false,
    auto_generate_password: true,
    require_change_password: true,
  };
}

function isOwner(member: StaffUser): boolean {
  return member.user_role === "system_admin";
}


function sectionLabel(key: string): string {
  return (
    TRANS_CHAP_SECTION_LABELS[key as keyof typeof TRANS_CHAP_SECTION_LABELS] ??
    MERCHANT_SECTION_LABELS[key as keyof typeof MERCHANT_SECTION_LABELS] ??
    key
  );
}

function sectionsSummary(sections: string[]): string {
  if (sections.length === 0) return "No access";
  return sections.map(sectionLabel).join(", ");
}

function toggleSection(current: string[], key: string, checked: boolean): string[] {
  if (checked) {
    return current.includes(key) ? current : [...current, key];
  }
  return current.filter((s) => s !== key);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "S";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function TransChapTeamSettings({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<TeamView>("list");
  const [members, setMembers] = useState<StaffUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const [editMember, setEditMember] = useState<StaffUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [passwordMember, setPasswordMember] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [linkSending, setLinkSending] = useState(false);
  const [inviteLookup, setInviteLookup] =
    useState<UserInviteLookupState>(EMPTY_INVITE_LOOKUP);
  const [createMode, setCreateMode] = useState<CreateMode>("invite");
  const [createdCredentials, setCreatedCredentials] =
    useState<CreatedCredentials | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    try {
      const res = await apiFetch<StaffListResponse>(apiRoutes.staff);
      setMembers(res.data);
    } catch (err) {
      await showError("Could not load team", extractErrorMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const sectionOptions: MerchantSectionOption[] = TRANS_CHAP_STAFF_SECTIONS.map(
    (key) => ({
      key,
      label: sectionLabel(key),
    }),
  );

  function goList() {
    setView("list");
    setCreateForm(emptyCreateForm());
    setInviteLookup(EMPTY_INVITE_LOOKUP);
    setCreateMode("invite");
    setCreatedCredentials(null);
    setCopiedField(null);
    setEditMember(null);
    setEditForm(null);
    setPasswordMember(null);
    setNewPassword("");
    setMustChangePassword(true);
  }

  function openCreate(mode: CreateMode) {
    setCreateMode(mode);
    setCreateForm(emptyCreateForm());
    setInviteLookup(EMPTY_INVITE_LOOKUP);
    setCreatedCredentials(null);
    setView("create");
  }

  function handleBack() {
    if (view === "password") {
      setView("edit");
      setPasswordMember(null);
      setNewPassword("");
      setMustChangePassword(true);
      return;
    }
    if (view === "list") {
      onClose();
      return;
    }
    goList();
  }

  async function copyText(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(
        () => setCopiedField((current) => (current === field ? null : current)),
        2000,
      );
      await toastSuccess(`${field} copied`);
    } catch {
      await showError("Could not copy", "Copy it by hand from this screen.");
    }
  }

  function openEdit(member: StaffUser) {
    if (isOwner(member)) return;
    setEditMember(member);
    setEditForm({
      name: member.name,
      phone: member.phone ?? "",
      is_activated: member.is_activated,
      allowed_sections: clampToTransChapSections(member.allowed_sections),
    });
    setView("edit");
  }

  function handleInviteLookupResolved(result: UserInviteLookupResult) {
    if (!result.found || result.invite_blocked || result.already_member) {
      return;
    }
    setCreateForm((f) => ({
      ...f,
      name: result.name?.trim() || f.name,
      phone: result.phone?.trim() || f.phone,
      password: "",
      send_reset_email: false,
    }));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const email = createForm.email.trim();
    if (!email.includes("@")) {
      await showError("Email required", "Enter a valid email address.");
      return;
    }

    const inviting = createMode === "invite";
    if (inviting && !inviteLookupReady(inviteLookup)) {
      await showError(
        "Look up email first",
        "Search for the email before adding this team member.",
      );
      return;
    }

    const allowedSections = clampToTransChapSections([
      "dashboard",
      ...createForm.allowed_sections,
    ]);
    if (allowedSections.length === 0) {
      await showError("Select access", "Choose at least one TransChap area.");
      return;
    }

    setCreating(true);
    try {
      if (!inviting) {
        let lookup: UserInviteLookupResult;
        try {
          lookup = await apiFetch<UserInviteLookupResult>(apiRoutes.staffLookup(email));
        } catch (err) {
          await showError("Could not check email", extractErrorMessage(err));
          setCreating(false);
          return;
        }
        if (lookup.invite_blocked) {
          await showError(
            "Cannot create this user",
            lookup.invite_blocked_reason ?? "This account cannot be added.",
          );
          setCreating(false);
          return;
        }
        if (lookup.already_member) {
          await showError(
            "Already on the team",
            "This email already belongs to someone on this shop.",
          );
          setCreating(false);
          return;
        }
        if (lookup.found) {
          await showError(
            "Account already exists",
            "This email already has a TransChap login. Switch to Invite user to add them without a new password.",
          );
          setCreating(false);
          return;
        }
      }

      const isExisting = inviting && inviteLookupIsExisting(inviteLookup);
      const password = isExisting
        ? ""
        : createForm.auto_generate_password
          ? generateTempPassword()
          : createForm.password.trim();
      if (!isExisting && password.length < 8) {
        await showError(
          "Password required",
          createForm.auto_generate_password
            ? "Could not generate a password. Try again."
            : "New users need a password of at least 8 characters.",
        );
        setCreating(false);
        return;
      }

      const res = await apiFetch<StaffActionResponse>(apiRoutes.staff, {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          email,
          phone: createForm.phone.trim() || null,
          ...(password ? { password } : {}),
          allowed_sections: allowedSections,
          require_change_password: !isExisting && createForm.require_change_password,
          send_invite_email: createForm.send_reset_email,
        }),
      });
      setMembers((prev) => [...prev, res.data]);
      if (!isExisting && password) {
        setCreatedCredentials({
          name: res.data.name,
          email: res.data.email ?? email,
          password,
        });
        setView("credentials");
        return;
      }
      await toastSuccess(res.message || "Staff member added");
      goList();
    } catch (err) {
      await showError("Could not add staff", extractErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!editMember || !editForm) return;
    const allowedSections = clampToTransChapSections([
      "dashboard",
      ...editForm.allowed_sections,
    ]);
    if (allowedSections.length === 0) {
      await showError("Select access", "Choose at least one TransChap area.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await apiFetch<StaffActionResponse>(
        apiRoutes.staffMember(editMember.id),
        {
          method: "PATCH",
          body: JSON.stringify({
            name: editForm.name.trim(),
            phone: editForm.phone.trim() || null,
            is_activated: editForm.is_activated,
            allowed_sections: allowedSections,
          }),
        },
      );
      setMembers((prev) => prev.map((m) => (m.id === res.data.id ? res.data : m)));
      await toastSuccess("Staff member updated");
      goList();
    } catch (err) {
      await showError("Could not update staff", extractErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeMember(member: StaffUser) {
    if (isOwner(member)) return;
    const ok = await confirmAction(
      "Remove team member?",
      `${member.name} will lose access to this shop.`,
    );
    if (!ok) return;
    try {
      await apiFetch(apiRoutes.staffMember(member.id), { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      await toastSuccess("Staff member removed");
      goList();
    } catch (err) {
      await showError("Could not remove staff", extractErrorMessage(err));
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordMember) return;
    if (newPassword.trim().length < 8) {
      await showError("Password too short", "Use at least 8 characters.");
      return;
    }
    setPasswordSaving(true);
    try {
      await apiFetch<StaffPasswordResponse>(
        apiRoutes.staffPassword(passwordMember.id),
        {
          method: "POST",
          body: JSON.stringify({
            password: newPassword,
            require_change_password: mustChangePassword,
          }),
        },
      );
      await toastSuccess("Password updated");
      goList();
    } catch (err) {
      await showError("Could not update password", extractErrorMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  }

  async function sendResetLink(member: StaffUser) {
    setLinkSending(true);
    try {
      const res = await apiFetch<StaffPasswordResponse>(
        apiRoutes.staffPasswordResetLink(member.id),
        { method: "POST" },
      );
      setMembers((prev) =>
        prev.map((m) =>
          m.id === member.id ? { ...m, require_change_password: true } : m,
        ),
      );
      await toastSuccess(res.message);
    } catch (err) {
      await showError("Could not send reset email", extractErrorMessage(err));
    } finally {
      setLinkSending(false);
    }
  }

  const title =
    view === "create"
      ? "Add team member"
      : view === "edit"
        ? "Edit staff"
        : view === "password"
          ? "Password"
          : view === "credentials"
            ? "New user"
            : "Team";
  const owners = members.filter(isOwner);
  const staffMembers = members.filter((member) => !isOwner(member));
  const staffCount = staffMembers.length;
  const lookupReady = inviteLookupReady(inviteLookup);
  const existingUser = createMode === "invite" && inviteLookupIsExisting(inviteLookup);
  const showCreateForm = createMode === "create" || lookupReady;
  const showPasswordFields = showCreateForm && !existingUser;

  return (
    <div className="ios-settings">
      <button type="button" className="ios-settings__back" onClick={handleBack}>
        <i className="fa-solid fa-chevron-left" aria-hidden />
        {view === "list" ? "Settings" : view === "password" ? "Edit staff" : "Team"}
      </button>
      <h2 className="ios-settings__screen-title">{title}</h2>

      {view === "list" ? (
        <section className="ios-settings-detail">
          <p className="ios-settings__footer ios-settings__footer--top">
            Add staff, choose what they can access, and send an invitation or
            create their login. Only the shop owner can manage the team.
          </p>

          <div className="ios-settings__group">
            <button
              type="button"
              className="ios-settings__team-add"
              onClick={() => openCreate("invite")}
            >
              <span className="ios-settings__team-add-icon" aria-hidden>
                <i className="fa-solid fa-user-plus" />
              </span>
              <span>
                <strong>Add team member</strong>
                <small>Invite them or create a login</small>
              </span>
              <i className="fa-solid fa-chevron-right" aria-hidden />
            </button>
          </div>

          {owners.length > 0 ? (
            <div className="ios-settings__group">
              <h3 className="ios-settings__caption">Owner</h3>
              <div className="ios-settings__card">
                {owners.map((member) => (
                  <div
                    key={member.id}
                    className="ios-settings__row ios-settings__row--static"
                  >
                    <span
                      className="ios-settings__avatar ios-settings__avatar--sm"
                      aria-hidden
                    >
                      {initials(member.name)}
                    </span>
                    <span className="ios-settings__label-stack">
                      <strong>{member.name}</strong>
                      <span>{member.email ?? "Shop owner"}</span>
                    </span>
                    <span className="ios-settings__value">Owner</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="ios-settings__group">
            <h3 className="ios-settings__caption">
              {loaded ? `Staff · ${staffCount}` : "Staff"}
            </h3>
            <div className="ios-settings__card">
              {!loaded ? (
                <div className="ios-settings__row ios-settings__row--static">
                  <span className="ios-settings__label">Loading…</span>
                </div>
              ) : staffMembers.length === 0 ? (
                <div className="ios-settings__row ios-settings__row--static">
                  <span className="ios-settings__label-stack">
                    <strong>No staff yet</strong>
                    <span>Add your first team member above.</span>
                  </span>
                </div>
              ) : (
                staffMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="ios-settings__row"
                    onClick={() => openEdit(member)}
                  >
                    <span
                      className="ios-settings__avatar ios-settings__avatar--sm"
                      aria-hidden
                    >
                      {initials(member.name)}
                    </span>
                    <span className="ios-settings__label-stack">
                      <strong>{member.name}</strong>
                      <span>
                        {member.is_activated ? "Staff" : "Inactive"} ·{" "}
                        {member.allowed_sections.length} permissions
                      </span>
                      <span>{sectionsSummary(member.allowed_sections)}</span>
                    </span>
                    <i
                      className="fa-solid fa-chevron-right ios-settings__chevron"
                      aria-hidden
                    />
                  </button>
                ))
              )}
            </div>
            <p className="ios-settings__footer">
              Staff only see the areas you give them access to.
            </p>
          </div>
        </section>
      ) : null}

      {view === "create" ? (
        <section className="ios-settings-detail">
          <div className="ios-settings__group">
            <h3 className="ios-settings__caption">Identity</h3>
            <div className="ios-settings__card">
              <button
                type="button"
                role="radio"
                aria-checked={createMode === "invite"}
                className={`ios-settings__row${createMode === "invite" ? " is-selected" : ""}`}
                onClick={() => {
                  setCreateMode("invite");
                  setInviteLookup(EMPTY_INVITE_LOOKUP);
                }}
                disabled={creating}
              >
                <span className="ios-settings__label-stack">
                  <strong>Send an invitation</strong>
                  <span>For someone who already has a TransChap account</span>
                </span>
                {createMode === "invite" ? (
                  <i className="fa-solid fa-check ios-settings__check" aria-hidden />
                ) : null}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={createMode === "create"}
                className={`ios-settings__row${createMode === "create" ? " is-selected" : ""}`}
                onClick={() => {
                  setCreateMode("create");
                  setInviteLookup(EMPTY_INVITE_LOOKUP);
                }}
                disabled={creating}
              >
                <span className="ios-settings__label-stack">
                  <strong>Create their login</strong>
                  <span>Make a new account and temporary password</span>
                </span>
                {createMode === "create" ? (
                  <i className="fa-solid fa-check ios-settings__check" aria-hidden />
                ) : null}
              </button>
            </div>
            <p className="ios-settings__footer">
              {createMode === "create"
                ? "We’ll generate a temporary password that you can copy and give to them."
                : "Look up their email first. Existing TransChap users keep their current password."}
            </p>
          </div>

          {createMode === "invite" ? (
            <UserInviteEmailLookup
              email={createForm.email}
              onEmailChange={(email) => setCreateForm((f) => ({ ...f, email }))}
              lookupUrl={apiRoutes.staffLookup(createForm.email)}
              lookupState={inviteLookup}
              onLookupStateChange={setInviteLookup}
              onResolved={handleInviteLookupResolved}
              disabled={creating}
              variant="transchap"
              emailInputId="trans-chap-staff-email"
            />
          ) : null}

          {showCreateForm ? (
            <form className="ios-settings-detail" onSubmit={(e) => void handleCreate(e)}>
              {createMode === "create" ? (
                <div className="ios-settings__group">
                  <h3 className="ios-settings__caption">Email</h3>
                  <div className="ios-settings__card">
                    <label className="ios-settings__row ios-settings__row--field">
                      <span className="sr-only">Email</span>
                      <input
                        id="trans-chap-staff-create-email"
                        required
                        type="email"
                        autoComplete="email"
                        className="ios-settings__input"
                        placeholder="name@email.com"
                        value={createForm.email}
                        onChange={(e) =>
                          setCreateForm((f) => ({ ...f, email: e.target.value }))
                        }
                        disabled={creating}
                      />
                    </label>
                  </div>
                  <p className="ios-settings__footer">
                    This becomes their login. You’ll get a password to copy after
                    creating.
                  </p>
                </div>
              ) : null}

              <div className="ios-settings__group">
                <h3 className="ios-settings__caption">Profile</h3>
                <div className="ios-settings__card">
                  <label className="ios-settings__row ios-settings__row--field">
                    <span className="sr-only">Name</span>
                    <input
                      required
                      autoComplete="name"
                      className="ios-settings__input"
                      placeholder="Display name"
                      value={createForm.name}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="ios-settings__row ios-settings__row--field">
                    <span className="sr-only">Phone</span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      className="ios-settings__input"
                      placeholder="Phone (optional)"
                      value={createForm.phone}
                      onChange={(e) =>
                        setCreateForm((f) => ({ ...f, phone: e.target.value }))
                      }
                    />
                  </label>
                </div>
              </div>

              {showPasswordFields ? (
                <div className="ios-settings__group">
                  <h3 className="ios-settings__caption">Password</h3>
                  <div className="ios-settings__card">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={createForm.auto_generate_password}
                      className={`ios-settings__row${createForm.auto_generate_password ? " is-selected" : ""}`}
                      onClick={() =>
                        setCreateForm((f) => ({
                          ...f,
                          auto_generate_password: true,
                          password: "",
                        }))
                      }
                    >
                      <span className="ios-settings__label">Auto-generate password</span>
                      {createForm.auto_generate_password ? (
                        <i className="fa-solid fa-check ios-settings__check" aria-hidden />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!createForm.auto_generate_password}
                      className={`ios-settings__row${!createForm.auto_generate_password ? " is-selected" : ""}`}
                      onClick={() =>
                        setCreateForm((f) => ({
                          ...f,
                          auto_generate_password: false,
                        }))
                      }
                    >
                      <span className="ios-settings__label">Let me create the password</span>
                      {!createForm.auto_generate_password ? (
                        <i className="fa-solid fa-check ios-settings__check" aria-hidden />
                      ) : null}
                    </button>
                    {!createForm.auto_generate_password ? (
                      <label className="ios-settings__row ios-settings__row--field">
                        <span className="sr-only">Password</span>
                        <input
                          required
                          type="text"
                          minLength={8}
                          autoComplete="new-password"
                          className="ios-settings__input"
                          placeholder="At least 8 characters"
                          value={createForm.password}
                          onChange={(e) =>
                            setCreateForm((f) => ({ ...f, password: e.target.value }))
                          }
                        />
                      </label>
                    ) : null}
                    <div className="ios-settings__row ios-settings__row--static">
                      <span className="ios-settings__label">
                        Require change on first sign-in
                      </span>
                      <span className="ios-settings__trailing">
                        <button
                          type="button"
                          role="switch"
                          className={`theme-switch${createForm.require_change_password ? " is-on" : ""}`}
                          aria-checked={createForm.require_change_password}
                          onClick={() =>
                            setCreateForm((f) => ({
                              ...f,
                              require_change_password: !f.require_change_password,
                            }))
                          }
                        >
                          <span className="theme-switch__thumb" aria-hidden />
                        </button>
                      </span>
                    </div>
                  </div>
                  <p className="ios-settings__footer">
                    The password is shown once after you create the user. Copy it
                    and give it to them.
                  </p>
                </div>
              ) : null}

              <SectionPicker
                selected={createForm.allowed_sections}
                options={sectionOptions}
                onToggle={(key, checked) =>
                  setCreateForm((f) => ({
                    ...f,
                    allowed_sections: toggleSection(f.allowed_sections, key, checked),
                  }))
                }
              />

              <div className="ios-settings__group">
                <div className="ios-settings__card">
                  <div className="ios-settings__row ios-settings__row--static">
                    <span className="ios-settings__label">
                      {existingUser
                        ? "Email access notification"
                        : "Also email a setup link"}
                    </span>
                    <span className="ios-settings__trailing">
                      <button
                        type="button"
                        role="switch"
                        className={`theme-switch${createForm.send_reset_email ? " is-on" : ""}`}
                        aria-checked={createForm.send_reset_email}
                        onClick={() =>
                          setCreateForm((f) => ({
                            ...f,
                            send_reset_email: !f.send_reset_email,
                          }))
                        }
                      >
                        <span className="theme-switch__thumb" aria-hidden />
                      </button>
                    </span>
                  </div>
                </div>
              </div>

              <div className="ios-settings__actions">
                <button type="submit" className="auth-split__btn" disabled={creating}>
                  {creating
                    ? createMode === "create"
                      ? "Creating…"
                      : "Adding…"
                    : createMode === "create"
                      ? "Create user"
                      : "Add team member"}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {view === "credentials" && createdCredentials ? (
        <section className="ios-settings-detail">
          <p className="ios-settings__footer ios-settings__footer--top">
            {createdCredentials.name} can sign in now. Copy this password — it
            will not be shown again.
          </p>
          <div className="ios-settings__group">
            <h3 className="ios-settings__caption">Sign-in details</h3>
            <div className="ios-settings__card">
              <button
                type="button"
                className="ios-settings__row"
                onClick={() => void copyText(createdCredentials.email, "Email")}
              >
                <span className="ios-settings__label-stack">
                  <strong>Email</strong>
                  <span>{createdCredentials.email}</span>
                </span>
                <span className="ios-settings__value">
                  {copiedField === "Email" ? "Copied" : "Copy"}
                </span>
              </button>
              <button
                type="button"
                className="ios-settings__row"
                onClick={() => void copyText(createdCredentials.password, "Password")}
              >
                <span className="ios-settings__label-stack">
                  <strong>Password</strong>
                  <span className="ios-settings__secret">{createdCredentials.password}</span>
                </span>
                <span className="ios-settings__value">
                  {copiedField === "Password" ? "Copied" : "Copy"}
                </span>
              </button>
            </div>
          </div>
          <div className="ios-settings__actions">
            <button
              type="button"
              className="auth-split__btn"
              onClick={() =>
                void copyText(
                  `Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`,
                  "Sign-in details",
                )
              }
            >
              {copiedField === "Sign-in details" ? "Copied" : "Copy email and password"}
            </button>
            <button type="button" className="ios-settings__text-btn" onClick={goList}>
              Done
            </button>
          </div>
        </section>
      ) : null}

      {view === "edit" && editMember && editForm ? (
        <section className="ios-settings-detail">
          <form className="ios-settings-detail" onSubmit={(e) => void handleEditSave(e)}>
            <div className="ios-settings__group">
              <h3 className="ios-settings__caption">Profile</h3>
              <div className="ios-settings__card">
                <label className="ios-settings__row ios-settings__row--field">
                  <span className="sr-only">Name</span>
                  <input
                    required
                    className="ios-settings__input"
                    placeholder="Full name"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm((f) => f && { ...f, name: e.target.value })
                    }
                  />
                </label>
                <label className="ios-settings__row ios-settings__row--field">
                  <span className="sr-only">Phone</span>
                  <input
                    type="tel"
                    className="ios-settings__input"
                    placeholder="Phone"
                    value={editForm.phone}
                    onChange={(e) =>
                      setEditForm((f) => f && { ...f, phone: e.target.value })
                    }
                  />
                </label>
                <div className="ios-settings__row ios-settings__row--static">
                  <span className="ios-settings__label">Can sign in</span>
                  <span className="ios-settings__trailing">
                    <button
                      type="button"
                      role="switch"
                      className={`theme-switch${editForm.is_activated ? " is-on" : ""}`}
                      aria-checked={editForm.is_activated}
                      onClick={() =>
                        setEditForm((f) => f && { ...f, is_activated: !f.is_activated })
                      }
                    >
                      <span className="theme-switch__thumb" aria-hidden />
                    </button>
                  </span>
                </div>
              </div>
              <p className="ios-settings__footer">{editMember.email ?? "No email"}</p>
            </div>

            <SectionPicker
              selected={editForm.allowed_sections}
              options={sectionOptions}
              onToggle={(key, checked) =>
                setEditForm(
                  (f) =>
                    f && {
                      ...f,
                      allowed_sections: toggleSection(f.allowed_sections, key, checked),
                    },
                )
              }
            />

            <div className="ios-settings__actions">
              <button type="submit" className="auth-split__btn" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>

          <div className="ios-settings__group">
            <div className="ios-settings__card">
              <button
                type="button"
                className="ios-settings__row"
                onClick={() => {
                  setPasswordMember(editMember);
                  setNewPassword("");
                  setMustChangePassword(true);
                  setView("password");
                }}
              >
                <span className="ios-settings__label">Set password</span>
                <i className="fa-solid fa-chevron-right ios-settings__chevron" aria-hidden />
              </button>
              <button
                type="button"
                className="ios-settings__row"
                disabled={linkSending}
                onClick={() => void sendResetLink(editMember)}
              >
                <span className="ios-settings__label ios-settings__label--action">
                  {linkSending ? "Sending…" : "Email invite"}
                </span>
              </button>
            </div>
          </div>

          <section className="ios-settings__group" aria-label="Remove">
            <div className="ios-settings__card">
              <button
                type="button"
                className="ios-settings__row ios-settings__row--danger"
                onClick={() => void removeMember(editMember)}
              >
                <span className="ios-settings__label ios-settings__label--center">
                  Remove from team
                </span>
              </button>
            </div>
          </section>
        </section>
      ) : null}

      {view === "password" && passwordMember ? (
        <section className="ios-settings-detail">
          <p className="ios-settings__footer ios-settings__footer--top">
            Set a new password for {passwordMember.name}.
          </p>
          <form className="ios-settings-detail" onSubmit={(e) => void savePassword(e)}>
            <div className="ios-settings__group">
              <h3 className="ios-settings__caption">New password</h3>
              <div className="ios-settings__card">
                <label className="ios-settings__row ios-settings__row--field">
                  <span className="sr-only">New password</span>
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    className="ios-settings__input"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <div className="ios-settings__row ios-settings__row--static">
                  <span className="ios-settings__label">Require change on next login</span>
                  <span className="ios-settings__trailing">
                    <button
                      type="button"
                      role="switch"
                      className={`theme-switch${mustChangePassword ? " is-on" : ""}`}
                      aria-checked={mustChangePassword}
                      onClick={() => setMustChangePassword((v) => !v)}
                    >
                      <span className="theme-switch__thumb" aria-hidden />
                    </button>
                  </span>
                </div>
              </div>
            </div>
            <div className="ios-settings__actions">
              <button type="submit" className="auth-split__btn" disabled={passwordSaving}>
                {passwordSaving ? "Saving…" : "Update password"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function SectionPicker({
  selected,
  options,
  onToggle,
}: {
  selected: string[];
  options: MerchantSectionOption[];
  onToggle: (key: string, checked: boolean) => void;
}) {
  return (
    <div className="ios-settings__group">
      <h3 className="ios-settings__caption">Access</h3>
      <div className="ios-settings__card">
        {options.map((section) => {
          const locked = section.key === "dashboard";
          const checked = locked || selected.includes(section.key);
          return (
            <button
              key={section.key}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-disabled={locked || undefined}
              className={`ios-settings__row${checked ? " is-selected" : ""}${locked ? " is-disabled" : ""}`}
              onClick={() => {
                if (locked) return;
                onToggle(section.key, !checked);
              }}
            >
              <span className="ios-settings__label">{section.label}</span>
              {checked ? (
                <i className="fa-solid fa-check ios-settings__check" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="ios-settings__footer">
        Only TransChap areas. Home is always included so they can open the app.
        Customers covers the directory and collecting on tab. POS & sales covers
        the register and walk-in receipts. Inventory covers stock and purchases.
        Settings controls the Settings menu (sign-out, camera, etc.).
      </p>
    </div>
  );
}
