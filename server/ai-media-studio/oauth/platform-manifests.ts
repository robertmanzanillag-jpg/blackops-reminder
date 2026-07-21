import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";

export type OAuthPlatformManifest = Readonly<{
  platform: AiMediaOAuthPlatform;
  defaultScopes: readonly string[];
  productionGate: string;
  docs: readonly string[];
}>;

export const AI_MEDIA_OAUTH_PLATFORM_MANIFESTS: Readonly<Record<AiMediaOAuthPlatform, OAuthPlatformManifest>> = {
  tiktok: {
    platform: "tiktok",
    defaultScopes: ["user.info.basic", "video.upload", "video.publish"],
    productionGate: "TikTok Content Posting API approval, redirect URI registration, account authorization, and publish/upload permission are required before live posting.",
    docs: [
      "https://developers.tiktok.com/doc/oauth-user-access-token-management",
      "https://developers.tiktok.com/doc/content-posting-api-get-started",
    ],
  },
  instagram: {
    platform: "instagram",
    defaultScopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"],
    productionGate: "Meta app review, an eligible Instagram professional account, Page-linked identity discovery, and publishing permission are required before live posting.",
    docs: [
      "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
      "https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api",
    ],
  },
  facebook: {
    platform: "facebook",
    defaultScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    productionGate: "Meta app review, Page task access, and Page publishing permissions are required before live posting.",
    docs: [
      "https://developers.facebook.com/docs/pages-api/posts/",
      "https://developers.facebook.com/docs/facebook-login/guides/access-tokens/",
    ],
  },
  youtube_shorts: {
    platform: "youtube_shorts",
    defaultScopes: ["https://www.googleapis.com/auth/youtube.upload"],
    productionGate: "Google OAuth verification/API Services review, channel authorization, and YouTube upload quota readiness are required before videos.insert.",
    docs: [
      "https://developers.google.com/identity/protocols/oauth2/web-server",
      "https://developers.google.com/youtube/v3/guides/authentication",
      "https://developers.google.com/youtube/v3/docs/videos",
    ],
  },
};
