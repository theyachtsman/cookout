"use client";

import { useParams } from "next/navigation";
import { PublicProfile } from "../../../components/PublicProfile";

/**
 * The creator profile is now the Creator tab of the merged public profile.
 * This route stays so every existing /creator/:address link keeps working —
 * it just deep-links straight to the Creator tab.
 */
export default function CreatorPage() {
  const { address } = useParams<{ address: string }>();
  return <PublicProfile address={address} initialTab="creator" />;
}
