/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@cookout/shared"],
  // /submissions was the launch page. It is a modal on the Cook Out now, but
  // the old URL is in bookmarks, Telegram posts and anything the crowd shared
  // — so it lands on the Cook Out with the form already open rather than 404.
  async redirects() {
    return [{ source: "/submissions", destination: "/matches?launch=1", permanent: false }];
  },
};

export default nextConfig;
