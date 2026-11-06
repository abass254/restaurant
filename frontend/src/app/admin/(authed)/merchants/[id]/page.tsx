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

function getUserInitials(name?: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
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
  const [copiedId, setCopiedId] = useState(false);
  const [userFilter, setUserFilter] = useState("");
  const [showPasswordInEditor, setShowPasswordInEditor] = useState(false);
  const [showPasswordInInvite, setShowPasswordInInvite] = useState(false);
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

  const copyMerchantId = () => {
    if (!merchant?.id) return;
    void navigator.clipboard.writeText(merchant.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const ownerCount = useMemo(() => {
    return (merchant?.users ?? []).filter((u) => u.user_role === "system_admin")
      .length;
  }, [merchant?.users]);

  const staffCount = useMemo(() => {
    return (merchant?.users ?? []).filter((u) => u.user_role !== "system_admin")
      .length;
  }, [merchant?.users]);

  const filteredUsers = useMemo(() => {
    if (!merchant?.users) return [];
    const query = userFilter.trim().toLowerCase();
    if (!query) return merchant.users;
    return merchant.users.filter(
      (u) =>
        u.name?.toLowerCase().includes(query) ||
        u.email?.toLowerCase().includes(query) ||
        u.username?.toLowerCase().includes(query),
    );
  }, [merchant?.users, userFilter]);

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
      <div className="admin-breadcrumbs-wrap">
        <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
          <Link href="/admin/merchants">
            <i className="fas fa-arrow-left" aria-hidden="true" />
            <span>Merchants</span>
          </Link>
          {merchant ? (
            <>
              <span className="admin-breadcrumbs__sep">/</span>
              <span
                className="admin-breadcrumbs__current"
                title={merchant.business_name}
              >
                {merchant.business_name}
              </span>
            </>
          ) : null}
        </nav>

        {merchant ? (
          <div className="admin-breadcrumbs__actions">
            <button
              type="button"
              className={`admin-merchant-header__copy-id${
                copiedId ? " is-copied" : ""
              }`}
              onClick={copyMerchantId}
              title="Copy merchant ID"
            >
              <i
                className={`fas ${copiedId ? "fa-check" : "fa-copy"}`}
                aria-hidden="true"
              />
              <span>{copiedId ? "Copied ID!" : merchant.id.slice(0, 8)}</span>
            </button>
            <a
              href={`/m/${merchant.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-breadcrumbs a"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.32rem 0.75rem",
                borderRadius: "8px",
                fontSize: "0.82rem",
                fontWeight: 600,
                textDecoration: "none",
                background: "var(--color-surface, #fff)",
                border: "1px solid var(--color-border, #e2e8f0)",
                color: "var(--color-primary, #0d9488)",
              }}
              title="Open public merchant storefront in a new tab"
            >
              <i
                className="fas fa-arrow-up-right-from-square"
                aria-hidden="true"
              />
              <span>Storefront</span>
            </a>
          </div>
        ) : null}
      </div>

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
            <div className="admin-merchant-header__avatar-wrap">
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
                  <i
                    className={`fas ${
                      parseStoreType(merchant.store_type) === "restaurant"
                        ? "fa-utensils"
                        : "fa-store"
                    }`}
                  />
                )}
              </span>
            </div>
            <div className="admin-merchant-header__body">
              <div className="admin-merchant-header__title-row">
                <div className="admin-merchant-header__title-group">
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
                  <span className="admin-pill admin-pill--success">
                    <i className="fas fa-circle-check" aria-hidden="true" />
                    Active
                  </span>
                </div>
              </div>

              <div className="admin-merchant-header__sub">
                <span>
                  <i className="fas fa-tag" aria-hidden="true" />{" "}
                  {merchant.business_category || "Category not set"}
                </span>
                {merchant.business_location ? (
                  <>
                    <span>•</span>
                    <span>
                      <i className="fas fa-location-dot" aria-hidden="true" />{" "}
                      {merchant.business_location}
                    </span>
                  </>
                ) : null}
              </div>

              <div className="admin-merchant-header__meta">
                <button
                  type="button"
                  className={`admin-merchant-header__copy-id${
                    copiedId ? " is-copied" : ""
                  }`}
                  onClick={copyMerchantId}
                  title="Click to copy full ID"
                >
                  <i
                    className={`fas ${copiedId ? "fa-check" : "fa-hashtag"}`}
                    aria-hidden="true"
                  />
                  <code>{copiedId ? "Copied to clipboard!" : merchant.id}</code>
                </button>
                <span className="admin-merchant-header__badge-pill">
                  <i className="fas fa-calendar-plus" aria-hidden="true" />
                  Joined {formatDate(merchant.created_at)}
                </span>
                <span className="admin-merchant-header__badge-pill">
                  <i className="fas fa-users" aria-hidden="true" />
                  {merchant.users.length}{" "}
                  {merchant.users.length === 1 ? "member" : "members"}
                </span>
                {merchant.instagram_connected ? (
                  <span className="admin-channel-badge admin-channel-badge--instagram">
                    <i className="fab fa-instagram" aria-hidden="true" />
                    {merchant.instagram_username
                      ? `@${merchant.instagram_username}`
                      : "Instagram"}
                  </span>
                ) : null}
                {(merchant.connected_channels ?? []).some(
                  (c) => c.platform === "whatsapp",
                ) ? (
                  <span className="admin-channel-badge admin-channel-badge--whatsapp">
                    <i className="fab fa-whatsapp" aria-hidden="true" />
                    WhatsApp
                  </span>
                ) : null}
              </div>
            </div>
          </header>

          <section className="admin-section">
            <header className="admin-section__head">
              <h2 className="admin-section__title">Merchant overview</h2>
              <span className="admin-chip">
                <i className="fas fa-chart-pie" aria-hidden="true" />
                Snapshot
              </span>
            </header>

            <dl className="admin-merchant-facts">
              <div className="admin-merchant-facts__item">
                <div className="admin-merchant-facts__top">
                  <dt>Store type</dt>
                  <span
                    className="admin-merchant-facts__icon"
                    aria-hidden="true"
                  >
                    <i
                      className={`fas ${
                        parseStoreType(merchant.store_type) === "restaurant"
                          ? "fa-utensils"
                          : "fa-store"
                      }`}
                    />
                  </span>
                </div>
                <dd>
                  {storeTypeLabel(merchant.store_type)}
                  <span className="admin-merchant-facts__sub">
                    {parseStoreType(merchant.store_type) === "restaurant"
                      ? "Food & Beverage service"
                      : "Retail commerce catalog"}
                  </span>
                </dd>
              </div>

              <div className="admin-merchant-facts__item">
                <div className="admin-merchant-facts__top">
                  <dt>What they sell</dt>
                  <span
                    className="admin-merchant-facts__icon"
                    aria-hidden="true"
                  >
                    <i className="fas fa-tags" />
                  </span>
                </div>
                <dd>
                  {merchant.business_category || "—"}
                  <span className="admin-merchant-facts__sub">
                    Primary business category
                  </span>
                </dd>
              </div>

              <div className="admin-merchant-facts__item">
                <div className="admin-merchant-facts__top">
                  <dt>Location</dt>
                  <span
                    className="admin-merchant-facts__icon"
                    aria-hidden="true"
                  >
                    <i className="fas fa-location-dot" />
                  </span>
                </div>
                <dd>
                  {merchant.business_location || "Not specified"}
                  <span className="admin-merchant-facts__sub">
                    Physical operating area
                  </span>
                </dd>
              </div>

              <div className="admin-merchant-facts__item">
                <div className="admin-merchant-facts__top">
                  <dt>Coordinates</dt>
                  <span
                    className="admin-merchant-facts__icon"
                    aria-hidden="true"
                  >
                    <i className="fas fa-compass" />
                  </span>
                </div>
                <dd>
                  {merchant.latitude != null && merchant.longitude != null ? (
                    <>
                      <span>
                        {merchant.latitude.toFixed(5)},{" "}
                        {merchant.longitude.toFixed(5)}
                      </span>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${merchant.latitude},${merchant.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="admin-merchant-facts__link"
                      >
                        <i className="fas fa-map" aria-hidden="true" />
                        <span>View on Google Maps</span>
                      </a>
                    </>
                  ) : (
                    <>
                      <span>Not set</span>
                      <span className="admin-merchant-facts__sub">
                        No GPS coordinates mapped
                      </span>
                    </>
                  )}
                </dd>
              </div>

              <div className="admin-merchant-facts__item">
                <div className="admin-merchant-facts__top">
                  <dt>Team size</dt>
                  <span
                    className="admin-merchant-facts__icon"
                    aria-hidden="true"
                  >
                    <i className="fas fa-users" />
                  </span>
                </div>
                <dd>
                  {merchant.users.length} registered{" "}
                  {merchant.users.length === 1 ? "user" : "users"}
                  <span className="admin-merchant-facts__sub">
                    {ownerCount} {ownerCount === 1 ? "owner" : "owners"},{" "}
                    {staffCount} {staffCount === 1 ? "staff" : "staff"}
                  </span>
                </dd>
              </div>

              <div className="admin-merchant-facts__item">
                <div className="admin-merchant-facts__top">
                  <dt>Last updated</dt>
                  <span
                    className="admin-merchant-facts__icon"
                    aria-hidden="true"
                  >
                    <i className="fas fa-clock-rotate-left" />
                  </span>
                </div>
                <dd>
                  {formatDate(merchant.updated_at)}
                  <span className="admin-merchant-facts__sub">
                    Nairobi local time
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="admin-section">
            <header className="admin-section__head">
              <div>
                <h2 className="admin-section__title">Store configuration</h2>
                <p
                  className="admin-section__lead"
                  style={{ margin: "0.25rem 0 0" }}
                >
                  Set store operational model, product category, and business details.
                </p>
              </div>
              <span className="admin-chip">
                <i className="fas fa-sliders" aria-hidden="true" />
                Settings
              </span>
            </header>

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
                        {selected ? (
                          <span
                            className="admin-merchant-type__card-check"
                            aria-hidden="true"
                          >
                            <i className="fas fa-check" />
                          </span>
                        ) : null}
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
                        {selected ? (
                          <i
                            className="fas fa-check"
                            aria-hidden="true"
                            style={{ fontSize: "0.75rem" }}
                          />
                        ) : null}
                        <span>{option}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="admin-merchant-type__fields">
                <div className="admin-merchant-type__input-group">
                  <label className="admin-field-label" htmlFor="merchant-name">
                    Business name <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <div className="admin-merchant-type__input-wrap">
                    <i className="fas fa-store" aria-hidden="true" />
                    <input
                      id="merchant-name"
                      value={profileName}
                      onChange={(e) => {
                        setProfileName(e.target.value);
                        setProfileError(null);
                        setProfileSuccess(null);
                      }}
                      required
                      maxLength={255}
                      placeholder="e.g. Acme Coffee & Retail"
                    />
                  </div>
                </div>

                <div className="admin-merchant-type__input-group">
                  <label
                    className="admin-field-label"
                    htmlFor="merchant-location"
                  >
                    Operating location
                  </label>
                  <div className="admin-merchant-type__input-wrap">
                    <i className="fas fa-location-dot" aria-hidden="true" />
                    <input
                      id="merchant-location"
                      value={profileLocation}
                      onChange={(e) => {
                        setProfileLocation(e.target.value);
                        setProfileError(null);
                        setProfileSuccess(null);
                      }}
                      maxLength={255}
                      placeholder="City, neighborhood, or street address"
                    />
                  </div>
                </div>
              </div>

              {profileDirty ? (
                <div className="admin-unsaved-bar">
                  <div className="admin-unsaved-bar__left">
                    <span
                      className="admin-unsaved-bar__dot"
                      aria-hidden="true"
                    />
                    <span>
                      You have unsaved changes to this merchant&apos;s
                      configuration.
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="admin-btn admin-btn--primary"
                    disabled={profileSaving}
                  >
                    {profileSaving ? (
                      <>
                        <i
                          className="fas fa-spinner fa-spin"
                          aria-hidden="true"
                        />
                        Saving…
                      </>
                    ) : (
                      <>
                        <i className="fas fa-floppy-disk" aria-hidden="true" />
                        Save changes
                      </>
                    )}
                  </button>
                </div>
              ) : null}

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

              {!profileDirty && (
                <div className="admin-merchant-type__actions">
                  <button
                    type="submit"
                    className="admin-btn admin-btn--ghost"
                    disabled={true}
                    style={{ opacity: 0.6 }}
                  >
                    <i className="fas fa-check" aria-hidden="true" />
                    Configuration saved
                  </button>
                </div>
              )}
            </form>
          </section>

          <section className="admin-section">
            <header className="admin-section__head">
              <div>
                <h2 className="admin-section__title">Social channels</h2>
                <p
                  className="admin-section__lead"
                  style={{ margin: "0.25rem 0 0" }}
                >
                  Connected messaging and social commerce channels for this shop.
                </p>
              </div>
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
                  supported platform yet. They can connect channels from their merchant settings.
                </p>
              </div>
            ) : (
              <div className="admin-channel-list">
                {(merchant.connected_channels ?? []).map((channel) => (
                  <div
                    key={channel.platform}
                    className="admin-channel-row admin-channel-row--modern"
                  >
                    <div className="admin-channel-row__main">
                      <span
                        className="admin-channel-row__icon"
                        aria-hidden="true"
                        style={{
                          background:
                            channel.platform === "whatsapp"
                              ? "#ecfdf5"
                              : channel.platform === "instagram"
                              ? "#fdf2f8"
                              : "var(--color-bg-muted, #faf8f5)",
                          color:
                            channel.platform === "whatsapp"
                              ? "#059669"
                              : channel.platform === "instagram"
                              ? "#db2777"
                              : "inherit",
                        }}
                      >
                        <i className={channel.icon} />
                      </span>
                      <div className="admin-channel-row__body">
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <strong>{channel.label}</strong>
                          <span
                            className={`admin-channel-badge admin-channel-badge--${
                              channel.platform === "whatsapp"
                                ? "whatsapp"
                                : "instagram"
                            }`}
                          >
                            Connected
                          </span>
                        </div>
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
                        title={`Detach ${channel.label}`}
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
              <div>
                <h2 className="admin-section__title">
                  Team & permissions
                </h2>
                <p
                  className="admin-section__lead"
                  style={{ margin: "0.25rem 0 0" }}
                >
                  Manage accounts with access to this store and configure their section permissions.
                </p>
              </div>
              <div
                className="admin-section__head-actions"
                style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
              >
                <span className="admin-chip">
                  <i className="fas fa-users" aria-hidden="true" />
                  {merchant.users.length}{" "}
                  {merchant.users.length === 1 ? "user" : "users"}
                </span>
                {merchant.users.length > 2 && (
                  <div className="admin-table__search-bar">
                    <i className="fas fa-magnifying-glass" aria-hidden="true" />
                    <input
                      type="search"
                      placeholder="Search users…"
                      value={userFilter}
                      onChange={(e) => setUserFilter(e.target.value)}
                    />
                  </div>
                )}
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
                    className={`fas ${
                      showInviteForm ? "fa-xmark" : "fa-user-plus"
                    }`}
                    aria-hidden="true"
                  />
                  {showInviteForm ? "Cancel invite" : "Invite team member"}
                </button>
              </div>
            </header>

            {inviteSuccess ? (
              <p
                className="admin-pill admin-pill--success"
                style={{ marginBottom: "0.85rem" }}
              >
                <i className="fas fa-check" aria-hidden="true" />
                {inviteSuccess}
              </p>
            ) : null}

            {showInviteForm ? (
              <form
                className="admin-inline-editor admin-inline-editor--stacked"
                style={{
                  marginBottom: "1.25rem",
                  border: "1.5px solid var(--color-border, #e8e2d8)",
                  borderRadius: "16px",
                  padding: "1.5rem",
                  background: "var(--color-surface, #fff)",
                  boxShadow: "0 4px 16px rgba(6, 26, 51, 0.04)",
                }}
                onSubmit={(e) => void inviteTeamMember(e)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "0.5rem",
                  }}
                >
                  <strong style={{ fontSize: "1.05rem" }}>
                    <i
                      className="fas fa-user-plus"
                      style={{
                        marginRight: "0.5rem",
                        color: "var(--color-primary, #0d9488)",
                      }}
                    />
                    Invite team member
                  </strong>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => setShowInviteForm(false)}
                  >
                    <i className="fas fa-xmark" aria-hidden="true" />
                  </button>
                </div>
                <p className="admin-muted" style={{ margin: "0 0 1rem" }}>
                  Create or link a staff account for this merchant. They sign in
                  at the merchant login portal using their email.
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
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(240px, 1fr))",
                        gap: "1rem",
                        margin: "1rem 0",
                      }}
                    >
                      <div
                        className="admin-inline-editor__row"
                        style={{ margin: 0 }}
                      >
                        <label
                          className="admin-field-label"
                          htmlFor="invite-name"
                        >
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
                      <div
                        className="admin-inline-editor__row"
                        style={{ margin: 0 }}
                      >
                        <label
                          className="admin-field-label"
                          htmlFor="invite-phone"
                        >
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
                    </div>

                    {!inviteLookupIsExisting(inviteLookup) ? (
                      <div
                        className="admin-inline-editor__row"
                        style={{ marginBottom: "1rem" }}
                      >
                        <label
                          className="admin-field-label"
                          htmlFor="invite-password"
                        >
                          Temporary password
                        </label>
                        <div
                          style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <input
                            id="invite-password"
                            type={showPasswordInInvite ? "text" : "password"}
                            className="admin-inline-editor__input"
                            value={invitePassword}
                            onChange={(e) => setInvitePassword(e.target.value)}
                            required
                            minLength={8}
                            maxLength={72}
                            autoComplete="new-password"
                            style={{ paddingRight: "2.75rem" }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPasswordInInvite((v) => !v)}
                            style={{
                              position: "absolute",
                              right: "0.75rem",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--color-text-subtle, #7d869a)",
                              fontSize: "0.9rem",
                            }}
                            title={
                              showPasswordInInvite
                                ? "Hide password"
                                : "Show password"
                            }
                          >
                            <i
                              className={`fas ${
                                showPasswordInInvite ? "fa-eye-slash" : "fa-eye"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <fieldset
                      className="admin-invite-sections"
                      style={{ border: "none", padding: 0, margin: "1rem 0" }}
                    >
                      <legend
                        style={{
                          fontWeight: 700,
                          fontSize: "0.85rem",
                          marginBottom: "0.5rem",
                        }}
                      >
                        Dashboard section access
                      </legend>
                      <div className="admin-invite-sections__grid">
                        {(sectionOptions.length > 0
                          ? sectionOptions
                          : MERCHANT_SECTIONS.map((key) => ({
                              key,
                              label: MERCHANT_SECTION_LABELS[key],
                            }))
                        ).map((section) => (
                          <label
                            key={section.key}
                            className="admin-invite-sections__option"
                          >
                            <input
                              type="checkbox"
                              checked={inviteSections.includes(section.key)}
                              onChange={(e) =>
                                setInviteSections((prev) =>
                                  toggleSection(
                                    prev,
                                    section.key,
                                    e.target.checked,
                                  ),
                                )
                              }
                            />
                            <span>{section.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <label
                      className="admin-inline-editor__checkbox"
                      style={{ margin: "0.75rem 0 1.25rem" }}
                    >
                      <input
                        type="checkbox"
                        checked={inviteSendEmail}
                        onChange={(e) => setInviteSendEmail(e.target.checked)}
                      />
                      {inviteLookupIsExisting(inviteLookup)
                        ? "Email access notification (no password change)"
                        : "Email password setup link after creating"}
                    </label>

                    <div
                      className="admin-inline-editor__row"
                      style={{ margin: 0 }}
                    >
                      <button
                        type="submit"
                        className="admin-btn admin-btn--primary"
                        disabled={inviteSaving}
                      >
                        {inviteSaving ? (
                          <>
                            <i
                              className="fas fa-spinner fa-spin"
                              aria-hidden="true"
                            />
                            Inviting…
                          </>
                        ) : (
                          <>
                            <i
                              className="fas fa-paper-plane"
                              aria-hidden="true"
                            />
                            Send invitation
                          </>
                        )}
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
                  This merchant has no users yet. Use &quot;Invite team
                  member&quot; to add staff, or they appear here after business
                  registration.
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
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          style={{ textAlign: "center", padding: "2rem" }}
                        >
                          <span className="admin-muted">
                            No users matched &quot;{userFilter}&quot;
                          </span>
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => (
                        <motion.tr key={u.id} variants={staggerItem}>
                          <td>
                            <div className="admin-table__primary">
                              <span
                                className={`admin-table__user-avatar${
                                  u.user_role === "system_admin"
                                    ? " admin-table__user-avatar--owner"
                                    : ""
                                }`}
                                aria-hidden="true"
                              >
                                {getUserInitials(u.name)}
                              </span>
                              <div>
                                <strong
                                  style={{
                                    color: "var(--color-text, #061a33)",
                                  }}
                                >
                                  {u.name}
                                </strong>
                                <code className="admin-table__id">
                                  {u.username
                                    ? `@${u.username}`
                                    : u.id.slice(0, 8)}
                                </code>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                color: "var(--color-text, #061a33)",
                                fontWeight: 500,
                              }}
                            >
                              {u.email ?? "—"}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`admin-pill ${
                                u.user_role === "system_admin"
                                  ? "admin-pill--success"
                                  : "admin-pill--neutral"
                              }`}
                            >
                              {u.user_role === "system_admin" ? (
                                <i
                                  className="fas fa-crown"
                                  aria-hidden="true"
                                  style={{ fontSize: "0.75rem" }}
                                />
                              ) : null}
                              {userRoleLabel(u)}
                            </span>
                          </td>
                          <td style={{ maxWidth: 220 }}>
                            {u.user_role === "system_admin" ? (
                              <span className="admin-section-tag admin-section-tag--full">
                                <i
                                  className="fas fa-shield-halved"
                                  aria-hidden="true"
                                />
                                Full access
                              </span>
                            ) : u.allowed_sections?.length ? (
                              <div className="admin-section-tag-group">
                                {u.allowed_sections.map((sec) => (
                                  <span key={sec} className="admin-section-tag">
                                    {MERCHANT_SECTION_LABELS[
                                      sec as keyof typeof MERCHANT_SECTION_LABELS
                                    ] ?? sec}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="admin-muted">—</span>
                            )}
                          </td>
                          <td>
                            {u.is_activated ? (
                              <span className="admin-pill admin-pill--success">
                                <i
                                  className="fas fa-check"
                                  aria-hidden="true"
                                />{" "}
                                Active
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
                                <i
                                  className="fas fa-key"
                                  aria-hidden="true"
                                  style={{ fontSize: "0.75rem" }}
                                />
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
                              title="Set a new temporary password"
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
                                  Email link
                                </>
                              )}
                            </button>
                          </td>
                        </motion.tr>
                      ))
                    )}
                    {passwordEditUserId && (
                      <motion.tr variants={staggerItem}>
                        <td colSpan={8}>
                          <div
                            className="admin-inline-editor"
                            style={{
                              padding: "1.25rem 1.5rem",
                              borderRadius: "14px",
                              border:
                                "1.5px solid var(--color-border-strong, #d4ccc0)",
                              background: "var(--color-surface, #fff)",
                              boxShadow: "0 4px 16px rgba(6, 26, 51, 0.06)",
                            }}
                          >
                            <div className="admin-inline-editor__header">
                              <strong
                                style={{
                                  fontSize: "1rem",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                }}
                              >
                                <i
                                  className="fas fa-key"
                                  style={{
                                    color: "var(--color-primary, #0d9488)",
                                  }}
                                />
                                Set temporary password for{" "}
                                {merchant.users.find(
                                  (u) => u.id === passwordEditUserId,
                                )?.name ?? "user"}
                              </strong>
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost"
                                onClick={closePasswordEditor}
                              >
                                <i
                                  className="fas fa-xmark"
                                  aria-hidden="true"
                                />{" "}
                                Close
                              </button>
                            </div>
                            <p
                              className="admin-muted"
                              style={{ margin: "0.35rem 0 1rem" }}
                            >
                              The user can sign in immediately using this
                              password. You can require them to create their own
                              new password on their next login.
                            </p>
                            <div
                              className="admin-inline-editor__row"
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "center",
                                gap: "1rem",
                              }}
                            >
                              <div
                                style={{
                                  position: "relative",
                                  display: "flex",
                                  alignItems: "center",
                                  flex: "1 1 240px",
                                  maxWidth: "340px",
                                }}
                              >
                                <input
                                  type={
                                    showPasswordInEditor ? "text" : "password"
                                  }
                                  className="admin-inline-editor__input"
                                  value={newPassword}
                                  onChange={(e) =>
                                    setNewPassword(e.target.value)
                                  }
                                  placeholder="New temporary password (min 8 chars)"
                                  autoComplete="new-password"
                                  style={{
                                    paddingRight: "2.75rem",
                                    width: "100%",
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowPasswordInEditor((v) => !v)
                                  }
                                  style={{
                                    position: "absolute",
                                    right: "0.75rem",
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    color: "var(--color-text-subtle, #7d869a)",
                                    fontSize: "0.9rem",
                                  }}
                                  title={
                                    showPasswordInEditor
                                      ? "Hide password"
                                      : "Show password"
                                  }
                                >
                                  <i
                                    className={`fas ${
                                      showPasswordInEditor
                                        ? "fa-eye-slash"
                                        : "fa-eye"
                                    }`}
                                  />
                                </button>
                              </div>
                              <label
                                className="admin-inline-editor__checkbox"
                                style={{ margin: 0 }}
                              >
                                <input
                                  type="checkbox"
                                  checked={mustChangeOnNextLogin}
                                  onChange={(e) =>
                                    setMustChangeOnNextLogin(e.target.checked)
                                  }
                                />
                                Require change on next login
                              </label>
                              <button
                                type="button"
                                className="admin-btn admin-btn--primary"
                                onClick={() =>
                                  resetUserPassword(passwordEditUserId)
                                }
                                disabled={
                                  passwordSavingUserId === passwordEditUserId
                                }
                              >
                                {passwordSavingUserId ===
                                passwordEditUserId ? (
                                  <>
                                    <i
                                      className="fas fa-spinner fa-spin"
                                      aria-hidden="true"
                                    />
                                    Saving…
                                  </>
                                ) : (
                                  <>
                                    <i
                                      className="fas fa-check"
                                      aria-hidden="true"
                                    />
                                    Save password
                                  </>
                                )}
                              </button>
                            </div>
                            {passwordActionError ? (
                              <p
                                className="admin-error"
                                style={{ marginTop: "0.75rem" }}
                              >
                                {passwordActionError}
                              </p>
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
        <Skeleton variant="rect" width={72} height={72} />
        <div className="admin-merchant-header__body" style={{ flex: 1 }}>
          <Skeleton variant="text" width="45%" height={28} />
          <Skeleton variant="text" width="35%" height={16} />
          <div
            className="admin-merchant-header__meta"
            style={{ marginTop: "0.75rem" }}
          >
            <Skeleton variant="text" width={180} height={24} />
            <Skeleton variant="text" width={140} height={24} />
            <Skeleton variant="text" width={120} height={24} />
          </div>
        </div>
      </div>

      <section className="admin-section" style={{ marginTop: "1.75rem" }}>
        <header className="admin-section__head">
          <Skeleton variant="text" width={240} height={22} />
          <Skeleton variant="text" width={56} height={22} />
        </header>

        <div className="admin-merchant-facts">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="admin-merchant-facts__item">
              <Skeleton variant="text" width="40%" height={14} />
              <Skeleton variant="text" width="70%" height={22} />
              <Skeleton variant="text" width="50%" height={12} />
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section" style={{ marginTop: "1.75rem" }}>
        <header className="admin-section__head">
          <Skeleton variant="text" width={240} height={22} />
          <Skeleton variant="text" width={56} height={22} />
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
                      <Skeleton variant="rect" width={36} height={36} />
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
                    <Skeleton variant="text" width={80} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={60} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={60} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={90} height={20} />
                  </td>
                  <td>
                    <Skeleton variant="text" width={110} height={28} />
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
