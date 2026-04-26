import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/demo/adecco-roleplay" as never);
}
