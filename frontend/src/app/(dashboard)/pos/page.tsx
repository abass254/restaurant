import { redirect } from "next/navigation";

/** POS lives on the station terminal. */
export default function PosRedirectPage() {
  redirect("/station");
}
