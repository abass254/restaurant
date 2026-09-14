"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { apiFetch, ApiError } from "@/lib/api";
import { confirmAction } from "@/lib/alerts";
import { apiRoutes, resolveAssetUrl } from "@/lib/config";
import { MotionFade } from "@/components/app/MotionList";
import { Skeleton } from "@/components/app/Skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type {
  AdminCreateMerchantUserResponse,
  AdminDetachMerchantChannelResponse,
  AdminMerchantChannel,
  AdminMerchantDetail,
  AdminMerchantDetailResponse,
  AdminMerchantProfileResponse,
  AdminMerchantSectionsResponse,
  AdminResetUserPasswordResponse,
  AdminSendPasswordResetLinkResponse,
  AdminUser,
} from "@/lib/types";
import {
  MERCHANT_SECTION_LABELS,
  MERCHANT_SECTIONS,
} from "@/lib/merchant-permissions";
import { formatNairobiDateTime } from "@/lib/nairobi-time";
import {
  EMPTY_INVITE_LOOKUP,
  inviteLookupIsExisting,
  inviteLookupReady,
  UserInviteEmailLookup,
  type UserInviteLookupState,
} from "@/components/app/UserInviteEmailLookup";
import type { UserInviteLookupResult } from "@/lib/types";
import {
  categoriesForStoreType,
  parseStoreType,
  STORE_TYPES,
  storeTypeLabel,
  type StoreType,
} from "@/lib/onboarding";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const formatted = formatNairobiDateTime(value);
  return formatted || value;
}

function userRoleLabel(user: AdminUser): string {
  if (user.user_role === "system_admin") return "Owner";
  if (user.user_role === "staff") return "Staff";
  return user.user_role ?? "User";
}

function sectionsSummary(sections: string[] | undefined): string {
  if (!sections?.length) return "—";
  return sections
    .map(
      (key) =>
        MERCHANT_SECTION_LABELS[key as keyof typeof MERCHANT_SECTION_LABELS] ??
        key,
    )
    .join(", ");
}

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

const SKELETON_USERS = 4;

export default function AdminMerchantDetailPage() {
  const params = useParams<{ id: string }>();
  const merchantId = params?.id ?? "";
  const [merchant, setMerchant] = useState<AdminMerchantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordEditUserId, setPasswordEditUserId] = useState<string | null>(
    null,
  );
  const [newPassword, setNewPassword] = useState("");
  const [mustChangeOnNextLogin, setMustChangeOnNextLogin] = useState(true);
  const [passwordActionError, setPasswordActionError] = useState<string | null>(
    null,
  );
  const [passwordActionSuccess, setPasswordActionSuccess] = useState<
    string | null
  >(null);
  const [passwordSavingUserId, setPasswordSavingUserId] = useState<string | null>(
    null,
  );
  const [linkSendingUserId, setLinkSendingUserId] = useState<string | null>(
    null,
  );
  const [detachingPlatform, setDetachingPlatform] = useState<string | null>(
    null,
  );
  const [channelActionError, setChannelActionError] = useState<string | null>(
    null,
  );
  const [channelActionSuccess, setChannelActionSuccess] = useState<
    string | null
  >(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [sectionOptions, setSectionOptions] = useState<
    { key: string; label: string }[]
  >([]);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteSections, setInviteSections] = useState<string[]>(["pos"]);
  const [inviteSendEmail, setInviteSendEmail] = useState(true);
  const [inviteLookup, setInviteLookup] =
    useState<UserInviteLookupState>(EMPTY_INVITE_LOOKUP);
  const [profileName, setProfileName] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileStoreType, setProfileStoreType] =
    useState<StoreType>("retail");
  const [profileCategory, setProfileCategory] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!merchantId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<AdminMerchantDetailResponse>(apiRoutes.adminMerchant(merchantId))
      .then((res) => {
        if (cancelled) return;
        setMerchant(res.data);
        setProfileName(res.data.business_name);
        setProfileLocation(res.data.business_location || "");
        setProfileStoreType(parseStoreType(res.data.store_type));
        setProfileCategory(res.data.business_category || "");
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load this merchant.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  useEffect(() => {
    if (!merchantId) return;
    let cancelled = false;
    apiFetch<AdminMerchantSectionsResponse>(
      apiRoutes.adminMerchantUserSections(merchantId),
    )
      .then((res) => {
        if (!cancelled) setSectionOptions(res.sections);
      })
      .catch(() => {
        if (!cancelled) {
          setSectionOptions(
            MERCHANT_SECTIONS.map((key) => ({
              key,
              label: MERCHANT_SECTION_LABELS[key],
            })),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  const categoryOptions = useMemo(() => {
    const allowed = categoriesForStoreType(profileStoreType);
    return Array.from(
      new Set([
        ...allowed,
        ...(profileCategory ? [profileCategory] : []),
      ]),
    );
  }, [profileCategory, profileStoreType]);

  const profileDirty = useMemo(() => {
    if (!merchant) return false;
    return (
      profileName.trim() !== merchant.business_name ||
      profileLocation.trim() !== (merchant.business_location || "") ||
      profileStoreType !== parseStoreType(merchant.store_type) ||
      profileCategory.trim() !== (merchant.business_category || "")
    );
  }, [
    merchant,
    profileCategory,
    profileLocation,
    profileName,
    profileStoreType,
  ]);

  function chooseStoreType(next: StoreType) {
    setProfileStoreType(next);
    const allowed = categoriesForStoreType(next);
    if (!allowed.includes(profileCategory as (typeof allowed)[number])) {
      setProfileCategory(allowed[0]);
    }
    setProfileError(null);
    setProfileSuccess(null);
  }

  async function saveMerchantProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!merchantId) return;
    const name = profileName.trim();
    const category = profileCategory.trim();
    if (!name) {
      setProfileError("Business name is required.");
      return;
    }
    if (!category) {
      setProfileError("Choose what this merchant sells.");
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const res = await apiFetch<AdminMerchantProfileResponse>(
        apiRoutes.adminMerchantProfile(merchantId),
        {
          method: "PATCH",
          body: JSON.stringify({
            business_name: name,
            business_location: profileLocation.trim(),
            business_category: category,
            store_type: profileStoreType,
          }),
        },
      );
      setMerchant(res.data);
      setProfileName(res.data.business_name);
      setProfileLocation(res.data.business_location || "");
      setProfileStoreType(parseStoreType(res.data.store_type));
      setProfileCategory(res.data.business_category || "");
      setProfileSuccess(res.message);
    } catch (err: unknown) {
      setProfileError(
        err instanceof ApiError
          ? err.message
          : "Could not save merchant profile.",
      );
    } finally {
      setProfileSaving(false);
    }
  }

  function resetInviteForm() {
    setInviteName("");
    setInviteEmail("");
    setInvitePhone("");
    setInvitePassword("");
    setInviteSections(["pos"]);
    setInviteSendEmail(true);
    setInviteError(null);
    setInviteLookup(EMPTY_INVITE_LOOKUP);
  }

  function handleInviteLookupResolved(result: UserInviteLookupResult) {
    if (!result.found || result.invite_blocked || result.already_member) {
      return;
    }
    setInviteName(result.name?.trim() || "");
    setInvitePhone(result.phone?.trim() || "");
    setInvitePassword("");
    setInviteSendEmail(!result.found);
  }

  async function inviteTeamMember(e: React.FormEvent) {
    e.preventDefault();
    if (!merchantId) return;
    if (!inviteLookupReady(inviteLookup)) {
      setInviteError("Look up the email before inviting this team member.");
      return;
    }
    if (inviteSections.length === 0) {
      setInviteError("Select at least one dashboard section.");
      return;
    }
    const password = invitePassword.trim();
    const isExisting = inviteLookupIsExisting(inviteLookup);
    if (!isExisting && password.length < 8) {
      setInviteError("New users need a temporary password of at least 8 characters.");
      return;
    }
    setInviteSaving(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const res = await apiFetch<AdminCreateMerchantUserResponse>(
        apiRoutes.adminMerchantUsers(merchantId),
        {
          method: "POST",
          body: JSON.stringify({
            name: inviteName.trim(),
            email: inviteEmail.trim(),
            phone: invitePhone.trim() || null,
            ...(password ? { password } : {}),
            allowed_sections: inviteSections,
            require_change_password: !isExisting && password.length >= 8,
            send_invite_email: inviteSendEmail,
          }),
        },
      );
      setMerchant((prev) =>
        prev ? { ...prev, users: [...prev.users, res.data] } : prev,
      );
      setInviteSuccess(res.message);
      resetInviteForm();
      setShowInviteForm(false);
    } catch (err: unknown) {
      setInviteError(
        err instanceof ApiError
          ? err.message
          : "Could not invite this team member.",
      );
    } finally {
      setInviteSaving(false);
    }
  }

  const closePasswordEditor = () => {
    setPasswordEditUserId(null);
    setNewPassword("");
    setMustChangeOnNextLogin(true);
    setPasswordActionError(null);
  };

  const openPasswordEditor = (userId: string) => {
    setPasswordEditUserId(userId);
    setNewPassword("");
    setMustChangeOnNextLogin(true);
    setPasswordActionError(null);
    setPasswordActionSuccess(null);
  };

  const resetUserPassword = async (userId: string) => {
    if (!merchantId) return;
    if (newPassword.trim().length < 8) {
      setPasswordActionError("Password must be at least 8 characters.");
      return;
    }
    setPasswordSavingUserId(userId);
    setPasswordActionError(null);
    setPasswordActionSuccess(null);
    try {
      const res = await apiFetch<AdminResetUserPasswordResponse>(
        apiRoutes.adminMerchantUserPassword(merchantId, userId),
        {
          method: "POST",
          body: JSON.stringify({
            password: newPassword,
            require_change_password: mustChangeOnNextLogin,
          }),
        },
      );
      setMerchant((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  require_change_password: res.require_change_password,
                }
              : u,
          ),
        };
      });
      setPasswordActionSuccess("Password updated successfully.");
      closePasswordEditor();
    } catch (err: unknown) {
      setPasswordActionError(
        err instanceof ApiError ? err.message : "Could not update password.",
      );
    } finally {
      setPasswordSavingUserId(null);
    }
  };

  const sendResetLink = async (userId: string) => {
    if (!merchantId) return;
    setLinkSendingUserId(userId);
    setPasswordActionError(null);
    setPasswordActionSuccess(null);
    try {
      const res = await apiFetch<AdminSendPasswordResetLinkResponse>(
        apiRoutes.adminMerchantUserPasswordResetLink(merchantId, userId),
        { method: "POST" },
      );
      setMerchant((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) =>
            u.id === userId ? { ...u, require_change_password: true } : u,
          ),
        };
      });
      setPasswordActionSuccess(res.message);
    } catch (err: unknown) {
      setPasswordActionError(
        err instanceof ApiError
          ? err.message
          : "Could not send the reset link.",
      );
    } finally {
      setLinkSendingUserId(null);
    }
  };

  const detachChannel = async (channel: AdminMerchantChannel) => {
    if (!merchantId) return;
    const handle = channel.username ? `@${channel.username}` : "this account";
    const confirmed = await confirmAction(
      `Detach ${channel.label}?`,
      `${handle} will be removed from ${merchant?.business_name ?? "this merchant"}. The merchant can reconnect from their dashboard later.`,
      "Yes, detach",
    );
    if (!confirmed) return;

    setDetachingPlatform(channel.platform);
    setChannelActionError(null);
    setChannelActionSuccess(null);
    try {
      const res = await apiFetch<AdminDetachMerchantChannelResponse>(
        apiRoutes.adminMerchantChannelDetach(merchantId, channel.platform),
        { method: "DELETE" },
      );
      setMerchant((prev) => {
        if (!prev) return prev;
        const connected_channels = (prev.connected_channels ?? []).filter(
          (c) => c.platform !== channel.platform,
        );
        const instagram = connected_channels.find(
          (c) => c.platform === "instagram",
        );
        return {
          ...prev,
          connected_channels,
          instagram_connected: instagram != null,
          instagram_username: instagram?.username ?? null,
        };
      });
      setChannelActionSuccess(res.message);
    } catch (err: unknown) {
      setChannelActionError(
        err instanceof ApiError
          ? err.message
          : `Could not detach ${channel.label}.`,
      );
    } finally {
      setDetachingPlatform(null);
    }
  };

  return (
    <section className="admin-page">
      <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
        <Link href="/admin/merchants">
          <i className="fas fa-arrow-left" aria-hidden="true" /> Merchants
        </Link>
      </nav>

      {loading ? (
        <MerchantDetailSkeleton />
      ) : error ? (
        <MotionFade>
          <p className="admin-error">{error}</p>
        </MotionFade>
      ) : !merchant ? (
        <MotionFade>
          <p className="admin-muted">Merchant not found.</p>
        </MotionFade>
      ) : (
        <MotionFade>
          <header className="admin-merchant-header">
            <span
              className="admin-merchant-header__avatar"
              aria-hidden="true"
            >
              {merchant.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveAssetUrl(merchant.logo_url) || ""}
                  alt=""
                  className="admin-merchant-header__logo"
                />
              ) : (
                <i className="fas fa-store" />
              )}
            </span>
            <div className="admin-merchant-header__body">
              <div className="admin-merchant-header__title-row">
                <h1>{merchant.business_name}</h1>
                <span className="admin-pill admin-pill--neutral">
                  <i
                    className={`fas ${
                      parseStoreType(merchant.store_type) === "restaurant"
                        ? "fa-utensils"
                        : "fa-store"
                    }`}
                    aria-hidden="true"
                  />
                  {storeTypeLabel(merchant.store_type)}
                </span>
              </div>
              <p>
                {merchant.business_category || "Category not set"}
                {merchant.business_location
                  ? ` · ${merchant.business_location}`
                  : ""}
              </p>
              <div className="admin-merchant-header__meta">
                <span>
                  <i className="fas fa-hashtag" aria-hidden="true" />{" "}
                  <code>{merchant.id}</code>
                </span>
                <span>
                  <i className="fas fa-calendar-plus" aria-hidden="true" />{" "}
                  Joined {formatDate(merchant.created_at)}
                </span>
                <span>
                  <i className="fas fa-users" aria-hidden="true" />{" "}
                  {merchant.users.length} user
                  {merchant.users.length === 1 ? "" : "s"}
                </span>
                {merchant.instagram_connected ? (
                  <span className="admin-pill admin-pill--success">
                    <i className="fab fa-instagram" aria-hidden="true" />
                    {merchant.instagram_username
                      ? `@${merchant.instagram_username}`
                      : "Instagram connected"}
                  </span>
                ) : (
                  <span className="admin-pill admin-pill--muted">
                    Instagram not connected
                  </span>
                )}
              </div>
            </div>
          </header>

          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">Merchant overview</h2>
              <span className="admin-chip">
                <i className="fas fa-id-card" aria-hidden="true" />
                Profile
              </span>
            </header>

            <dl className="admin-merchant-facts">
              <div className="admin-merchant-facts__item">
                <dt>Store type</dt>
                <dd>{storeTypeLabel(merchant.store_type)}</dd>
              </div>
              <div className="admin-merchant-facts__item">
                <dt>What they sell</dt>
                <dd>{merchant.business_category || "—"}</dd>
              </div>
              <div className="admin-merchant-facts__item">
                <dt>Location</dt>
                <dd>{merchant.business_location || "—"}</dd>
              </div>
              <div className="admin-merchant-facts__item">
                <dt>Coordinates</dt>
                <dd>
                  {merchant.latitude != null && merchant.longitude != null
                    ? `${merchant.latitude.toFixed(5)}, ${merchant.longitude.toFixed(5)}`
                    : "Not set"}
                </dd>
              </div>
              <div className="admin-merchant-facts__item">
                <dt>Team</dt>
                <dd>
                  {merchant.users.length} registered user
                  {merchant.users.length === 1 ? "" : "s"}
                </dd>
              </div>
              <div className="admin-merchant-facts__item">
                <dt>Last updated</dt>
                <dd>{formatDate(merchant.updated_at)}</dd>
              </div>
            </dl>
          </section>

          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">Merchant type</h2>
              <span className="admin-chip">
                <i className="fas fa-tags" aria-hidden="true" />
                What they sell
              </span>
            </header>
            <p className="admin-section__lead">
              Choose how this shop operates, then pick the category that best
              matches what they sell.
            </p>

            <form
              className="admin-merchant-type"
              onSubmit={(e) => void saveMerchantProfile(e)}
            >
              <div className="admin-merchant-type__block">
                <h3 className="admin-merchant-type__label">Store type</h3>
                <div
                  className="admin-merchant-type__cards"
                  role="radiogroup"
                  aria-label="Store type"
                >
                  {STORE_TYPES.map((option) => {
                    const selected = profileStoreType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`admin-merchant-type__card${
                          selected ? " is-selected" : ""
                        }`}
                        onClick={() => chooseStoreType(option.value)}
                      >
                        <span
                          className="admin-merchant-type__card-icon"
                          aria-hidden="true"
                        >
                          <i className={`fas ${option.icon}`} />
                        </span>
                        <span className="admin-merchant-type__card-copy">
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="admin-merchant-type__block">
                <h3 className="admin-merchant-type__label">What they sell</h3>
                <div
                  className="admin-merchant-type__chips"
                  role="radiogroup"
                  aria-label="Product category"
                >
                  {categoryOptions.map((option) => {
                    const selected = profileCategory === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`admin-merchant-type__chip${
                          selected ? " is-selected" : ""
                        }`}
                        onClick={() => {
                          setProfileCategory(option);
                          setProfileError(null);
                          setProfileSuccess(null);
                        }}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="admin-merchant-type__fields">
                <label className="admin-field-label" htmlFor="merchant-name">
                  Business name
                </label>
                <input
                  id="merchant-name"
                  className="admin-inline-editor__input"
                  value={profileName}
                  onChange={(e) => {
                    setProfileName(e.target.value);
                    setProfileError(null);
                    setProfileSuccess(null);
                  }}
                  required
                  maxLength={255}
                />
                <label
                  className="admin-field-label"
                  htmlFor="merchant-location"
                >
                  Location
                </label>
                <input
                  id="merchant-location"
                  className="admin-inline-editor__input"
                  value={profileLocation}
                  onChange={(e) => {
                    setProfileLocation(e.target.value);
                    setProfileError(null);
                    setProfileSuccess(null);
                  }}
                  maxLength={255}
                  placeholder="City, area, or address"
                />
              </div>

              {profileError ? (
                <p className="admin-error" role="alert">
                  {profileError}
                </p>
              ) : null}
              {profileSuccess ? (
                <p className="admin-pill admin-pill--success">
                  <i className="fas fa-check" aria-hidden="true" />
                  {profileSuccess}
                </p>
              ) : null}

              <div className="admin-merchant-type__actions">
                <button
                  type="submit"
                  className="admin-btn admin-btn--primary"
                  disabled={profileSaving || !profileDirty}
                >
                  {profileSaving ? "Saving…" : "Save merchant type"}
                </button>
              </div>
            </form>
          </section>

          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">Social channels</h2>
              <span className="admin-chip">
                <i className="fas fa-plug" aria-hidden="true" />
                {merchant.connected_channels?.length ?? 0} connected
              </span>
            </header>

            {(merchant.connected_channels?.length ?? 0) === 0 ? (
              <div className="admin-empty">
                <i className="fas fa-link-slash" aria-hidden="true" />
                <h3>No channels connected</h3>
                <p>
                  This merchant has not linked Instagram, WhatsApp, or any other
                  supported platform yet.
                </p>
              </div>
            ) : (
              <div className="admin-channel-list">
                {(merchant.connected_channels ?? []).map((channel) => (
                  <div key={channel.platform} className="admin-channel-row">
                    <div className="admin-channel-row__main">
                      <span
                        className="admin-channel-row__icon"
                        aria-hidden="true"
                      >
                        <i className={channel.icon} />
                      </span>
                      <div className="admin-channel-row__body">
                        <strong>{channel.label}</strong>
                        <span>
                          {channel.username
                            ? `@${channel.username}`
                            : "Connected account"}
                          {channel.display_name
                            ? ` · ${channel.display_name}`
                            : ""}
                        </span>
                      </div>
                    </div>
                    <div className="admin-channel-row__actions">
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--danger"
                        onClick={() => void detachChannel(channel)}
                        disabled={detachingPlatform === channel.platform}
                      >
                        {detachingPlatform === channel.platform ? (
                          <>
                            <i
                              className="fas fa-spinner fa-spin"
                              aria-hidden="true"
                            />
                            Detaching…
                          </>
                        ) : (
                          <>
                            <i
                              className="fas fa-unlink"
                              aria-hidden="true"
                            />
                            Detach
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {channelActionError ? (
              <p className="admin-error" style={{ marginTop: "0.85rem" }}>
                {channelActionError}
              </p>
            ) : null}
            {channelActionSuccess ? (
              <p
                className="admin-pill admin-pill--success"
                style={{ marginTop: "0.85rem" }}
              >
                <i className="fas fa-check" aria-hidden="true" />
                {channelActionSuccess}
              </p>
            ) : null}
          </section>

          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">
                Users registered for this merchant
              </h2>
              <div className="admin-section__head-actions">
                <span className="admin-chip">
                  <i className="fas fa-users" aria-hidden="true" />
                  {merchant.users.length}
                </span>
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={() => {
                    setShowInviteForm((v) => !v);
                    setInviteError(null);
                    setInviteSuccess(null);
                  }}
                >
                  <i
                    className={`fas ${showInviteForm ? "fa-xmark" : "fa-user-plus"}`}
                    aria-hidden="true"
                  />
                  {showInviteForm ? "Cancel" : "Invite team member"}
                </button>
              </div>
            </header>

            {inviteSuccess ? (
              <p className="admin-pill admin-pill--success" style={{ marginBottom: "0.85rem" }}>
                <i className="fas fa-check" aria-hidden="true" />
                {inviteSuccess}
              </p>
            ) : null}

            {showInviteForm ? (
              <form
                className="admin-inline-editor admin-inline-editor--stacked"
                style={{ marginBottom: "1rem" }}
                onSubmit={(e) => void inviteTeamMember(e)}
              >
                <p className="admin-muted">
                  Create a staff account for this merchant. They sign in at the
                  merchant login page with their email. Choose which dashboard
                  sections they can access.
                </p>
                {inviteError ? (
                  <p className="admin-error" role="alert">
                    {inviteError}
                  </p>
                ) : null}
                <UserInviteEmailLookup
                  email={inviteEmail}
                  onEmailChange={setInviteEmail}
                  lookupUrl={apiRoutes.adminMerchantUserLookup(
                    merchantId,
                    inviteEmail,
                  )}
                  lookupState={inviteLookup}
                  onLookupStateChange={setInviteLookup}
                  onResolved={handleInviteLookupResolved}
                  disabled={inviteSaving}
                  variant="admin"
                  emailInputId="invite-email"
                />
                {inviteLookupReady(inviteLookup) ? (
                  <>
                <div className="admin-inline-editor__row">
                  <label className="admin-field-label" htmlFor="invite-name">
                    Full name
                  </label>
                  <input
                    id="invite-name"
                    className="admin-inline-editor__input"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    required
                    maxLength={255}
                  />
                </div>
                <div className="admin-inline-editor__row">
                  <label className="admin-field-label" htmlFor="invite-phone">
                    Phone <span className="admin-muted">(optional)</span>
                  </label>
                  <input
                    id="invite-phone"
                    type="tel"
                    className="admin-inline-editor__input"
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    maxLength={20}
                  />
                </div>
                {!inviteLookupIsExisting(inviteLookup) ? (
                <div className="admin-inline-editor__row">
                  <label className="admin-field-label" htmlFor="invite-password">
                    Temporary password
                  </label>
                  <input
                    id="invite-password"
                    type="password"
                    className="admin-inline-editor__input"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    required
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                  />
                </div>
                ) : null}
                <fieldset className="admin-invite-sections">
                  <legend>Dashboard access</legend>
                  <div className="admin-invite-sections__grid">
                    {(sectionOptions.length > 0
                      ? sectionOptions
                      : MERCHANT_SECTIONS.map((key) => ({
                          key,
                          label: MERCHANT_SECTION_LABELS[key],
                        }))
                    ).map((section) => (
                      <label key={section.key} className="admin-invite-sections__option">
                        <input
                          type="checkbox"
                          checked={inviteSections.includes(section.key)}
                          onChange={(e) =>
                            setInviteSections((prev) =>
                              toggleSection(prev, section.key, e.target.checked),
                            )
                          }
                        />
                        <span>{section.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="admin-inline-editor__checkbox">
                  <input
                    type="checkbox"
                    checked={inviteSendEmail}
                    onChange={(e) => setInviteSendEmail(e.target.checked)}
                  />
                  {inviteLookupIsExisting(inviteLookup)
                    ? "Email access notification (no password change)"
                    : "Email password setup link after creating"}
                </label>
                <div className="admin-inline-editor__row">
                  <button
                    type="submit"
                    className="admin-btn admin-btn--primary"
                    disabled={inviteSaving}
                  >
                    {inviteSaving ? "Inviting…" : "Invite team member"}
                  </button>
                </div>
                  </>
                ) : null}
              </form>
            ) : null}

            {merchant.users.length === 0 ? (
              <div className="admin-empty">
                <i className="fas fa-user-slash" aria-hidden="true" />
                <h3>No users yet</h3>
                <p>
                  This merchant has no users yet. Use &quot;Invite team member&quot;
                  to add staff, or they appear here after business registration.
                </p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table admin-table--users">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Access</th>
                      <th>Activated</th>
                      <th>Onboarded</th>
                      <th>Password policy</th>
                      <th className="admin-table__actions">Actions</th>
                    </tr>
                  </thead>
                  <motion.tbody
                    variants={staggerContainer}
                    initial="hidden"
                    animate="visible"
                  >
                    {merchant.users.map((u) => (
                      <motion.tr key={u.id} variants={staggerItem}>
                        <td>
                          <div className="admin-table__primary">
                            <span
                              className="admin-table__avatar admin-table__avatar--user"
                              aria-hidden="true"
                            >
                              <i className="fas fa-user" />
                            </span>
                            <div>
                              <strong>{u.name}</strong>
                              <code className="admin-table__id">
                                {u.username
                                  ? `@${u.username}`
                                  : u.id.slice(0, 8)}
                              </code>
                            </div>
                          </div>
                        </td>
                        <td>{u.email ?? "—"}</td>
                        <td>
                          <span
                            className={`admin-pill ${
                              u.user_role === "system_admin"
                                ? "admin-pill--success"
                                : "admin-pill--neutral"
                            }`}
                          >
                            {userRoleLabel(u)}
                          </span>
                        </td>
                        <td className="admin-muted" style={{ maxWidth: 180 }}>
                          {u.user_role === "staff"
                            ? sectionsSummary(u.allowed_sections)
                            : "Full dashboard"}
                        </td>
                        <td>
                          {u.is_activated ? (
                            <span className="admin-pill admin-pill--success">
                              <i
                                className="fas fa-check"
                                aria-hidden="true"
                              />{" "}
                              Yes
                            </span>
                          ) : (
                            <span className="admin-pill admin-pill--warning">
                              <i
                                className="fas fa-hourglass-half"
                                aria-hidden="true"
                              />{" "}
                              Pending
                            </span>
                          )}
                        </td>
                        <td>
                          {u.onboarded_at ? (
                            <span className="admin-pill admin-pill--success">
                              <i
                                className="fas fa-check"
                                aria-hidden="true"
                              />{" "}
                              Yes
                            </span>
                          ) : (
                            <span className="admin-pill admin-pill--muted">
                              No
                            </span>
                          )}
                        </td>
                        <td>
                          {u.require_change_password ? (
                            <span className="admin-pill admin-pill--warning">
                              Must change
                            </span>
                          ) : (
                            <span className="admin-pill admin-pill--neutral">
                              No prompt
                            </span>
                          )}
                        </td>
                        <td className="admin-table__actions">
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost"
                            onClick={() => openPasswordEditor(u.id)}
                            disabled={passwordSavingUserId === u.id}
                          >
                            <i className="fas fa-key" aria-hidden="true" />
                            Set password
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost"
                            onClick={() => sendResetLink(u.id)}
                            disabled={
                              linkSendingUserId === u.id || !u.email
                            }
                            title={
                              u.email
                                ? "Email the user a temporary password and reset link"
                                : "This user has no email address on file"
                            }
                          >
                            {linkSendingUserId === u.id ? (
                              <>
                                <i
                                  className="fas fa-spinner fa-spin"
                                  aria-hidden="true"
                                />
                                Sending…
                              </>
                            ) : (
                              <>
                                <i
                                  className="fas fa-paper-plane"
                                  aria-hidden="true"
                                />
                                Email reset link
                              </>
                            )}
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                    {passwordEditUserId && (
                      <motion.tr variants={staggerItem}>
                        <td colSpan={8}>
                          <div className="admin-inline-editor">
                            <div className="admin-inline-editor__header">
                              <strong>Set a temporary password</strong>
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost"
                                onClick={closePasswordEditor}
                              >
                                Close
                              </button>
                            </div>
                            <p className="admin-muted">
                              The user can sign in using this password. You can
                              force them to change it on next login.
                            </p>
                            <div className="admin-inline-editor__row">
                              <input
                                type="password"
                                className="admin-inline-editor__input"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="New temporary password"
                                autoComplete="new-password"
                              />
                              <label className="admin-inline-editor__checkbox">
                                <input
                                  type="checkbox"
                                  checked={mustChangeOnNextLogin}
                                  onChange={(e) =>
                                    setMustChangeOnNextLogin(e.target.checked)
                                  }
                                />
                                Require password change on next login
                              </label>
                              <button
                                type="button"
                                className="admin-btn admin-btn--primary"
                                onClick={() =>
                                  resetUserPassword(passwordEditUserId)
                                }
                                disabled={passwordSavingUserId === passwordEditUserId}
                              >
                                {passwordSavingUserId === passwordEditUserId
                                  ? "Saving..."
                                  : "Save password"}
                              </button>
                            </div>
                            {passwordActionError ? (
                              <p className="admin-error">{passwordActionError}</p>
                            ) : null}
                          </div>
                        </td>
                      </motion.tr>
                    )}
                  </motion.tbody>
                </table>
              </div>
            )}
            {passwordActionSuccess ? (
              <p
                className="admin-pill admin-pill--success"
                style={{ marginTop: "0.85rem" }}
              >
                <i className="fas fa-check" aria-hidden="true" />
                {passwordActionSuccess}
              </p>
            ) : null}
          </section>
        </MotionFade>
      )}
    </section>
  );
}

function MerchantDetailSkeleton() {
  return (
    <div aria-busy="true">
      <div className="admin-merchant-header">
        <Skeleton variant="rect" width={56} height={56} />
        <div className="admin-merchant-header__body" style={{ flex: 1 }}>
          <Skeleton variant="text" width="45%" height={26} />
          <Skeleton variant="text" width="35%" height={14} />
          <div className="admin-merchant-header__meta">
            <Skeleton variant="text" width={180} height={12} />
            <Skeleton variant="text" width={140} height={12} />
            <Skeleton variant="text" width={120} height={20} />
          </div>
        </div>
      </div>

      <section className="admin-section" style={{ marginTop: "1.75rem" }}>
        <header className="admin-section__head">
          <Skeleton variant="text" width={240} height={20} />
          <Skeleton variant="text" width={56} height={20} />
        </header>

        <div className="admin-table-wrap">
          <table className="admin-table admin-table--users admin-table--skeleton">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Access</th>
                <th>Activated</th>
                <th>Onboarded</th>
                <th>Password policy</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_USERS }).map((_, i) => (
                <tr key={i}>
                  <td>
                    <div className="admin-table__primary">
                      <Skeleton variant="rect" width={34} height={34} />
                      <div style={{ flex: 1 }}>
                        <Skeleton variant="text" width="70%" height={14} />
                        <Skeleton variant="text" width="40%" height={10} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <Skeleton variant="text" width="80%" height={14} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={50} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={50} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={110} height={12} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={90} height={20} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
