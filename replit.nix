{ pkgs }: {
  deps = [
    pkgs.yt-dlp
    pkgs.ffmpeg
    pkgs.deno
    pkgs.nodejs_20
    pkgs.imagemagick
    pkgs.tesseract
  ];
}
