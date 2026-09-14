import Image from "next/image";

export default function BrandLogo() {
  return (
    <Image
      className="brand-icon"
      src="/assura-logo.svg"
      width={40}
      height={40}
      alt=""
      aria-hidden="true"
      unoptimized
    />
  );
}
