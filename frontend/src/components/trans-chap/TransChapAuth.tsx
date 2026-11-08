"use client";

import Link from "next/link";
import { TransChapLogoMark } from "@/components/trans-chap/TransChapLogoMark";

export function TransChapBrandHeader() {
    return (
        <div className="auth-split__brand trans-chap-auth__brand">
            <Link href="/sign-in" className="auth-split__logo trans-chap-auth__logo">
                <TransChapLogoMark size={60} color="currentColor" accentColor="#cfae6c" />
                <span className="auth-split__wordmark trans-chap-auth__wordmark">transchap</span>
            </Link>
            <p className="auth-split__tagline trans-chap-auth__tagline">
                Restaurant POS, Kitchen & Stock
            </p>
        </div>
    );
}
