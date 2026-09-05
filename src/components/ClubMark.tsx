import Image from "next/image";

export function ClubMark({ size = 42 }: { size?: number }) {
  return (
    <Image
      className="club-mark"
      src="/brand/ucl-hiking-club.png"
      width={size}
      height={size}
      alt=""
      priority
    />
  );
}
