import { VideoStudio } from "@/components/staff/video-studio";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  await requireStaffPage();
  return <VideoStudio />;
}
