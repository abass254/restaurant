import { redirect } from "next/navigation";
import { redirectIfSignedIn } from "@/lib/server-auth";

export default async function Home() {
  await redirectIfSignedIn();
  redirect("/sign-in");
}
