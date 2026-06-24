{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.deno
    pkgs.yt-dlp
    pkgs.ffmpeg
    pkgs.imagemagick
    pkgs.tesseract
  ];
}
