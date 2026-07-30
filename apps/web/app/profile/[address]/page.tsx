"use client";

import { useParams } from "next/navigation";
import { PublicProfile } from "../../../components/PublicProfile";

export default function PublicProfilePage() {
  const { address } = useParams<{ address: string }>();
  return <PublicProfile address={address} />;
}
