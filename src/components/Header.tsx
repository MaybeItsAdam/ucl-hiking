import Link from "next/link";
import { getCurrentMember, getRolePreviewState } from "@/lib/session";
import { ClubMark } from "@/components/ClubMark";
import { AccountButton } from "@/components/AccountButton";

export async function Header() {
  const member = await getCurrentMember();
  const previewState = await getRolePreviewState();

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="UCL Hiking Club home">
        <ClubMark />
        <span><strong>UCL Hiking</strong> Club</span>
      </Link>
      <AccountButton
        member={member}
        isRealAdmin={previewState.isRealAdmin}
        preview={previewState.preview}
        realMember={previewState.realMember}
      />
    </header>
  );
}
