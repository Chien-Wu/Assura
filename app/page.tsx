import { getChatGPTUser } from "./chatgpt-auth";
import Workspace from "./workspace";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  return <Workspace user={user ? { name: user.fullName ?? user.email } : null} />;
}
