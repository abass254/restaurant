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
  RETAIL_STAFF_SECTIONS,
} from "@/lib/merchant-permissions";
import { generateTempPassword } from "@/lib/temp-password";
import type {
  MerchantSectionOption,
  StaffActionResponse,
  StaffListResponse,
  StaffPasswordResponse,
  StaffUser,
  UserInviteLookupResult,
} from "@/lib/types";
import { MotionModal } from "./MotionModal";
import { Skeleton } from "./Skeleton";

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

type EditForm = {
  name: string;
  phone: string;
  is_activated: boolean;
  allowed_sections: string[];
};

type CreatedCredentials = {
  name: string;
  email: string;
  password: string;
};

function emptyCreateForm(defaultSections: string[]): CreateForm {
  return {
    name: "",
    email: "",
    phone: "",
    password: "",
    allowed_sections:
      defaultSections.length > 0 ? [...defaultSections] : ["dashboard"],
    send_reset_email: false,
    auto_generate_password: true,
    require_change_password: true,
  };
}

function roleLabel(member: StaffUser): string {
  if (member.user_role === "system_admin") return "Owner";
  return "Staff";
}

function isOwner(member: StaffUser): boolean {
  return member.user_role === "system_admin";
}

function sectionsSummary(sections: string[]): string {
  if (sections.length === 0) return "No sections";
  return sections
    .map((key) => MERCHANT_SECTION_LABELS[key as keyof typeof MERCHANT_SECTION_LABELS] ?? key)
    .join(", ");
}

export function StaffTeamSection() {
  const defaultSections = RETAIL_STAFF_SECTIONS.includes("pos")
    ? ["pos"]
    : [RETAIL_STAFF_SECTIONS[0] || "dashboard"];

  const [members, setMembers] = useState<StaffUser[]>([]);
  const [sections, setSections] = useState<MerchantSectionOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(() =>
    emptyCreateForm(defaultSections),
  );
  const [creating, setCreating] = useState(false);
  const [createdCredentials, setCreatedCredentials] =
    useState<CreatedCredentials | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [editMember, setEditMember] = useState<StaffUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [passwordMember, setPasswordMember] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [linkSendingId, setLinkSendingId] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    try {
      const res = await apiFetch<StaffListResponse>(apiRoutes.staff);
      setMembers(res.data);
      setSections(res.sections);
    } catch (err) {
      await showError("Could not load team", extractErrorMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  function toggleSection(
    current: string[],
    key: string,
    checked: boolean,
  ): string[] {
    if (checked) {
      return current.includes(key) ? current : [...current, key];
    }
    return current.filter((s) => s !== key);
  }

  function openEdit(member: StaffUser) {
    if (isOwner(member)) return;
    setEditMember(member);
    setEditForm({
      name: member.name,
      phone: member.phone ?? "",
      is_activated: member.is_activated,
      allowed_sections: [...member.allowed_sections],
    });
  }

  function closeEdit() {
    setEditMember(null);
    setEditForm(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const email = createForm.email.trim();
    if (!email.includes("@")) {
      await showError("Email required", "Enter a valid email address.");
      return;
    }
    if (createForm.allowed_sections.length === 0) {
      await showError("Select sections", "Choose at least one dashboard area.");
      return;
    }
    setCreating(true);
    try {
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
          "This email already has a TransChap login. Ask them to sign in, or remove them from another shop first.",
        );
        setCreating(false);
        return;
      }

      const password = createForm.auto_generate_password
        ? generateTempPassword()
        : createForm.password.trim();
      if (password.length < 8) {
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
          password,
          allowed_sections: createForm.allowed_sections,
          require_change_password: createForm.require_change_password,
          send_invite_email: createForm.send_reset_email,
        }),
      });
      setMembers((prev) => [...prev, res.data]);
      setShowCreate(false);
      setCreateForm(emptyCreateForm(defaultSections));
      setCreatedCredentials({
        name: res.data.name,
        email: res.data.email ?? email,
        password,
      });
    } catch (err) {
      await showError("Could not add staff", extractErrorMessage(err));
    } finally {
      setCreating(false);
    }
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

  async function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!editMember || !editForm) return;
    if (editForm.allowed_sections.length === 0) {
      await showError("Select sections", "Choose at least one dashboard area.");
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
            allowed_sections: editForm.allowed_sections,
          }),
        },
      );
      setMembers((prev) =>
        prev.map((m) => (m.id === res.data.id ? res.data : m)),
      );
      await toastSuccess("Staff member updated");
      closeEdit();
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
      `${member.name} will lose access to your shop dashboard.`,
    );
    if (!ok) return;
    try {
      await apiFetch(apiRoutes.staffMember(member.id), { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      await toastSuccess("Staff member removed");
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
      setPasswordMember(null);
      setNewPassword("");
      setMustChangePassword(true);
    } catch (err) {
      await showError("Could not update password", extractErrorMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  }

  async function sendResetLink(member: StaffUser) {
    setLinkSendingId(member.id);
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
      setLinkSendingId(null);
    }
  }

  const staffCount = members.filter((m) => !isOwner(m)).length;

  const sectionOptions: MerchantSectionOption[] =
    sections.length > 0
      ? sections
      : RETAIL_STAFF_SECTIONS.map((key) => ({
          key,
          label: MERCHANT_SECTION_LABELS[key],
        }));

  function closeCreate() {
    if (creating) return;
    setShowCreate(false);
    setCreateForm(emptyCreateForm(defaultSections));
  }

  function closeCredentials() {
    setCreatedCredentials(null);
    setCopiedField(null);
  }

  return (
    <article id="section-team" className="settings-card">
      <header className="settings-card__head">
        <div className="settings-card__title">
          <i className="fa-solid fa-users settings-card__icon" aria-hidden="true" />
          <h2>Team members</h2>
        </div>
        <span className={`settings-pill settings-pill--${staffCount > 0 ? "ok" : "warn"}`}>
          {staffCount} staff
        </span>
      </header>
      <div className="settings-card__body">
        <p className="settings-muted">
          Create staff logins with a password you can hand over. Each person only
          sees the dashboard sections you assign.
        </p>

        <div className="settings-card__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            <i className="fa-solid fa-user-plus" aria-hidden="true" />
            Create user
          </button>
        </div>

        {!loaded ? (
          <Skeleton className="settings-skeleton" />
        ) : members.length === 0 ? (
          <p className="settings-muted">No team members yet.</p>
        ) : (
          <ul className="riders-list">
            {members.map((member) => (
              <li key={member.id} className="riders-list__item">
                <div className="riders-list__main">
                  <strong>{member.name}</strong>
                  <span className="app-muted">{member.email ?? "—"}</span>
                  {!isOwner(member) ? (
                    <span className="app-muted">{sectionsSummary(member.allowed_sections)}</span>
                  ) : null}
                </div>
                <div className="riders-list__meta">
                  <span
                    className={`settings-pill settings-pill--${
                      isOwner(member) || member.is_activated ? "ok" : "off"
                    }`}
                  >
                    {roleLabel(member)}
                    {!isOwner(member) && !member.is_activated ? " · inactive" : ""}
                  </span>
                  {member.require_change_password && !isOwner(member) ? (
                    <span className="app-muted">Must change password</span>
                  ) : null}
                </div>
                {!isOwner(member) ? (
                  <div className="settings-card__actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => openEdit(member)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setPasswordMember(member);
                        setNewPassword("");
                        setMustChangePassword(true);
                      }}
                    >
                      Password
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={linkSendingId === member.id}
                      onClick={() => void sendResetLink(member)}
                    >
                      {linkSendingId === member.id ? "Sending…" : "Email invite"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm orders-danger"
                      onClick={() => void removeMember(member)}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <MotionModal
        open={showCreate}
        onClose={closeCreate}
        ariaLabelledBy="staff-create-title"
        closeOnBackdrop={!creating}
        closeOnEscape={!creating}
      >
        <header className="inventory-modal__head">
          <h2 id="staff-create-title">Create user</h2>
          <button
            type="button"
            className="fb-icon-btn"
            aria-label="Close"
            onClick={closeCreate}
            disabled={creating}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <form
          className="settings-form settings-form--compact staff-modal-form"
          onSubmit={(e) => void handleCreate(e)}
        >
          <div className="inventory-modal__body">
            <p className="settings-muted">
              Create a new login, auto-generate a password, then copy it once and
              give it to them.
            </p>
            <label className="settings-field">
              <span>Display name</span>
              <input
                required
                autoComplete="name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </label>
            <label className="settings-field">
              <span>Email</span>
              <input
                required
                type="email"
                autoComplete="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </label>
            <label className="settings-field">
              <span>Phone (optional)</span>
              <input
                type="tel"
                autoComplete="tel"
                value={createForm.phone}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, phone: e.target.value }))
                }
              />
            </label>

            <fieldset className="staff-access-fieldset">
              <legend>Password</legend>
              <label className="settings-field settings-field--checkbox">
                <input
                  type="radio"
                  name="staff-password-mode"
                  checked={createForm.auto_generate_password}
                  onChange={() =>
                    setCreateForm((f) => ({
                      ...f,
                      auto_generate_password: true,
                      password: "",
                    }))
                  }
                />
                <span>Auto-generate password</span>
              </label>
              <label className="settings-field settings-field--checkbox">
                <input
                  type="radio"
                  name="staff-password-mode"
                  checked={!createForm.auto_generate_password}
                  onChange={() =>
                    setCreateForm((f) => ({
                      ...f,
                      auto_generate_password: false,
                    }))
                  }
                />
                <span>Let me create the password</span>
              </label>
              {!createForm.auto_generate_password ? (
                <label className="settings-field">
                  <span>Password</span>
                  <input
                    required
                    type="text"
                    minLength={8}
                    autoComplete="new-password"
                    value={createForm.password}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, password: e.target.value }))
                    }
                  />
                </label>
              ) : null}
              <label className="settings-field settings-field--checkbox">
                <input
                  type="checkbox"
                  checked={createForm.require_change_password}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      require_change_password: e.target.checked,
                    }))
                  }
                />
                <span>Require change on first sign-in</span>
              </label>
            </fieldset>

            <fieldset className="staff-access-fieldset">
              <legend>Dashboard access</legend>
              <div className="staff-section-grid">
                {sectionOptions.map((section) => (
                  <label key={section.key} className="staff-section-option">
                    <input
                      type="checkbox"
                      checked={createForm.allowed_sections.includes(section.key)}
                      onChange={(e) =>
                        setCreateForm((f) => ({
                          ...f,
                          allowed_sections: toggleSection(
                            f.allowed_sections,
                            section.key,
                            e.target.checked,
                          ),
                        }))
                      }
                    />
                    <span>{section.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="settings-field settings-field--checkbox">
              <input
                type="checkbox"
                checked={createForm.send_reset_email}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    send_reset_email: e.target.checked,
                  }))
                }
              />
              <span>Also email a setup link</span>
            </label>

            <div className="settings-actions">
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? "Creating…" : "Create user"}
              </button>
            </div>
          </div>
        </form>
      </MotionModal>

      <MotionModal
        open={!!createdCredentials}
        onClose={closeCredentials}
        ariaLabelledBy="staff-credentials-title"
      >
        {createdCredentials ? (
          <>
            <header className="inventory-modal__head">
              <h2 id="staff-credentials-title">New user</h2>
              <button
                type="button"
                className="fb-icon-btn"
                aria-label="Close"
                onClick={closeCredentials}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </header>
            <div className="inventory-modal__body staff-credentials">
              <p className="settings-muted">
                {createdCredentials.name} can sign in now. Copy this password —
                it will not be shown again.
              </p>
              <label className="settings-field">
                <span>Email</span>
                <div className="staff-credentials__row">
                  <input readOnly value={createdCredentials.email} />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void copyText(createdCredentials.email, "Email")}
                  >
                    {copiedField === "Email" ? "Copied" : "Copy"}
                  </button>
                </div>
              </label>
              <label className="settings-field">
                <span>Password</span>
                <div className="staff-credentials__row">
                  <input
                    readOnly
                    className="staff-credentials__secret"
                    value={createdCredentials.password}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      void copyText(createdCredentials.password, "Password")
                    }
                  >
                    {copiedField === "Password" ? "Copied" : "Copy"}
                  </button>
                </div>
              </label>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void copyText(
                      `Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`,
                      "Sign-in details",
                    )
                  }
                >
                  {copiedField === "Sign-in details"
                    ? "Copied"
                    : "Copy email and password"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeCredentials}
                >
                  Done
                </button>
              </div>
            </div>
          </>
        ) : null}
      </MotionModal>

      <MotionModal
        open={!!editMember && !!editForm}
        onClose={closeEdit}
        ariaLabelledBy="staff-edit-title"
        closeOnBackdrop={!savingEdit}
        closeOnEscape={!savingEdit}
      >
        {editMember && editForm ? (
          <>
          <header className="inventory-modal__head">
            <h2 id="staff-edit-title">Edit {editMember.name}</h2>
            <button
              type="button"
              className="fb-icon-btn"
              aria-label="Close"
              onClick={closeEdit}
              disabled={savingEdit}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </header>
          <form
            className="settings-form settings-form--compact staff-modal-form"
            onSubmit={(e) => void handleEditSave(e)}
          >
            <div className="inventory-modal__body">
              <label className="settings-field">
                <span>Name</span>
                <input
                  required
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => f && { ...f, name: e.target.value })
                  }
                />
              </label>
              <label className="settings-field">
                <span>Phone</span>
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) =>
                    setEditForm((f) => f && { ...f, phone: e.target.value })
                  }
                />
              </label>
              <label className="settings-field settings-field--checkbox">
                <input
                  type="checkbox"
                  checked={editForm.is_activated}
                  onChange={(e) =>
                    setEditForm(
                      (f) => f && { ...f, is_activated: e.target.checked },
                    )
                  }
                />
                <span>Account active (can sign in)</span>
              </label>
              <fieldset className="staff-access-fieldset">
                <legend>Dashboard access</legend>
                <div className="staff-section-grid">
                  {sectionOptions.map((section) => (
                    <label key={section.key} className="staff-section-option">
                      <input
                        type="checkbox"
                        checked={editForm.allowed_sections.includes(section.key)}
                        onChange={(e) =>
                          setEditForm(
                            (f) =>
                              f && {
                                ...f,
                                allowed_sections: toggleSection(
                                  f.allowed_sections,
                                  section.key,
                                  e.target.checked,
                                ),
                              },
                          )
                        }
                      />
                      <span>{section.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="settings-actions">
                <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                  {savingEdit ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </form>
          </>
        ) : null}
        </MotionModal>

      <MotionModal
        open={!!passwordMember}
        onClose={() => {
          if (passwordSaving) return;
          setPasswordMember(null);
        }}
        ariaLabelledBy="staff-password-title"
        closeOnBackdrop={!passwordSaving}
        closeOnEscape={!passwordSaving}
      >
        {passwordMember ? (
          <>
          <header className="inventory-modal__head">
            <h2 id="staff-password-title">Set password for {passwordMember.name}</h2>
            <button
              type="button"
              className="fb-icon-btn"
              aria-label="Close"
              onClick={() => setPasswordMember(null)}
              disabled={passwordSaving}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </header>
          <form
            className="settings-form settings-form--compact staff-modal-form"
            onSubmit={(e) => void savePassword(e)}
          >
            <div className="inventory-modal__body">
              <label className="settings-field">
                <span>New password</span>
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label className="settings-field settings-field--checkbox">
                <input
                  type="checkbox"
                  checked={mustChangePassword}
                  onChange={(e) => setMustChangePassword(e.target.checked)}
                />
                <span>Require password change on next login</span>
              </label>
              <div className="settings-actions">
                <button type="submit" className="btn btn-primary" disabled={passwordSaving}>
                  {passwordSaving ? "Saving…" : "Update password"}
                </button>
              </div>
            </div>
          </form>
          </>
        ) : null}
        </MotionModal>
    </article>
  );
}
