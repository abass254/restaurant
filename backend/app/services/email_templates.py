"""Branded, email-client-safe HTML templates for outbound mail.

Email clients are notoriously inconsistent: no flexbox/grid, patchy CSS support,
Gmail strips ``<style>`` and SVG. So this uses table-based layout with inline
styles only, web-safe fonts, and a text wordmark instead of an image logo.

The single entry point is :func:`render_branded_email`, which wraps arbitrary
content (intro, paragraphs, a label/value details block, and an optional CTA
button) in the DukAI shell.
"""

from __future__ import annotations

from html import escape

# DukAI brand palette (mirrors the frontend's landing-ufanisi tokens).
BRAND = "#6b2e14"
BRAND_HOVER = "#8c3e1a"
ACCENT = "#d06848"
GRADIENT = "linear-gradient(135deg, #6b2e14, #8c3e1a)"
INK = "#2c1810"
MUTED = "#6b6157"
HAIRLINE = "#ece6df"
CANVAS = "#f5f1ec"
CARD = "#ffffff"


def _paragraph(text: str) -> str:
    return (
        f'<p style="margin:0 0 16px;color:{INK};font-size:15px;line-height:1.6;">'
        f"{escape(text)}</p>"
    )


def _details_table(rows: list[tuple[str, str]]) -> str:
    cells = "".join(
        f"""
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid {HAIRLINE};color:{MUTED};
                     font-size:13px;text-transform:uppercase;letter-spacing:.04em;
                     white-space:nowrap;vertical-align:top;">{escape(label)}</td>
          <td style="padding:10px 0 10px 16px;border-bottom:1px solid {HAIRLINE};
                     color:{INK};font-size:15px;font-weight:600;text-align:right;
                     vertical-align:top;">{escape(value)}</td>
        </tr>"""
        for label, value in rows
    )
    return f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:8px 0 20px;border-collapse:collapse;background:{CANVAS};
                    border-radius:12px;">
        <tr><td style="padding:6px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-collapse:collapse;">{cells}</table>
        </td></tr>
      </table>"""


def _cta_button(label: str, url: str) -> str:
    return f"""
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;">
        <tr><td style="border-radius:10px;background:{BRAND};">
          <a href="{escape(url, quote=True)}"
             style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;
                    color:#ffffff;text-decoration:none;border-radius:10px;">{escape(label)}</a>
        </td></tr>
      </table>"""


def _line_items_table(rows: list[tuple[str, str]], *, total_label: str, total_value: str) -> str:
    cells = "".join(
        f"""
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid {HAIRLINE};color:{INK};
                     font-size:14px;line-height:1.4;vertical-align:top;">{escape(name)}</td>
          <td style="padding:8px 0 8px 16px;border-bottom:1px solid {HAIRLINE};
                     color:{INK};font-size:14px;font-weight:600;text-align:right;
                     white-space:nowrap;vertical-align:top;">{escape(amount)}</td>
        </tr>"""
        for name, amount in rows
    )
    return f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:8px 0 20px;border-collapse:collapse;">
        {cells}
        <tr>
          <td style="padding:14px 0 4px;color:{INK};font-size:15px;font-weight:700;">
            {escape(total_label)}</td>
          <td style="padding:14px 0 4px;color:{INK};font-size:15px;font-weight:700;
                     text-align:right;white-space:nowrap;">{escape(total_value)}</td>
        </tr>
      </table>"""


def render_branded_email(
    *,
    title: str,
    heading: str,
    intro: str | None = None,
    paragraphs: list[str] | None = None,
    details: list[tuple[str, str]] | None = None,
    line_items: list[tuple[str, str]] | None = None,
    total_label: str | None = None,
    total_value: str | None = None,
    cta_label: str | None = None,
    cta_url: str | None = None,
    footer_note: str | None = None,
) -> str:
    """Return a full branded HTML email document."""
    body_blocks: list[str] = []
    if intro:
        body_blocks.append(_paragraph(intro))
    for text in paragraphs or []:
        body_blocks.append(_paragraph(text))
    if details:
        body_blocks.append(_details_table(details))
    if line_items and total_label and total_value:
        body_blocks.append(
            _line_items_table(line_items, total_label=total_label, total_value=total_value)
        )
    if cta_label and cta_url:
        body_blocks.append(_cta_button(cta_label, cta_url))
    inner = "".join(body_blocks)

    footer = footer_note or "You're receiving this because of activity on your DukAI account."

    # Preheader: hidden inbox-preview text shown after the subject in most clients.
    preheader = escape(intro or title)

    return f"""\
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>{escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:{CANVAS};
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:{CANVAS};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;width:100%;background:{CARD};border-radius:18px;
                    overflow:hidden;box-shadow:0 8px 28px rgba(44,24,16,0.08);">
        <!-- Header -->
        <tr><td style="background:{BRAND};background-image:{GRADIENT};padding:28px 32px;">
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;">
            Duk<span style="color:{ACCENT};">AI</span>
            <span style="color:{ACCENT};font-size:18px;">&#10022;</span>
          </span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 32px 12px;">
          <h1 style="margin:0 0 18px;color:{INK};font-size:21px;font-weight:700;
                     line-height:1.3;">{escape(heading)}</h1>
          {inner}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px 30px;border-top:1px solid {HAIRLINE};">
          <p style="margin:0 0 4px;color:{MUTED};font-size:12px;line-height:1.5;">{escape(footer)}</p>
          <p style="margin:0;color:{MUTED};font-size:12px;line-height:1.5;">
            &copy; DukAI &middot; Smart commerce for Instagram &amp; WhatsApp
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;color:{MUTED};font-size:11px;">
        Sent by DukAI. Please do not reply to this automated message.
      </p>
    </td></tr>
  </table>
</body>
</html>"""
