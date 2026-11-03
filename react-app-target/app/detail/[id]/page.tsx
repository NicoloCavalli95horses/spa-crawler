import DetailClient from "./DetailClient";

// Static export needs every route pre-enumerated at build time; must match server.js's `detail` list.
const KNOWN_IDS = [
  "07df7e91-ad83-4572-a1d9-0ab9556ec4e8",
  "48f32284-ce3e-4806-8f85-a120fc793e6e",
  "b7c56789-b338-4711-b3cb-f53725c69ee7",
];

export function generateStaticParams() {
  return KNOWN_IDS.map((id) => ({ id }));
}

export default async function DetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DetailClient id={id} />;
}
