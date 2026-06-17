#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$HOME/Movies}"
FALLBACK_INPUT_DIR="$ROOT_DIR/radio_video_edits/01_originales"
OUTPUT_DIR="$ROOT_DIR/radio_video_edits/03_listos_para_subir"

TARGET_SECONDS="${TARGET_SECONDS:-30}"
CUTS="${CUTS:-8}"
WIDTH="${WIDTH:-1080}"
HEIGHT="${HEIGHT:-1350}"
STYLE="${STYLE:-radio-post}"
SEARCH_DEPTH="${SEARCH_DEPTH:-3}"
FORCE="${FORCE:-0}"
SHORT_OUTPUT_RATIO="${SHORT_OUTPUT_RATIO:-0.75}"
DRIVE_FOLDER_NAME="${DRIVE_FOLDER_NAME:-videos editado para ig}"
DRIVE_OUTPUT_DIR="${DRIVE_OUTPUT_DIR:-}"

mkdir -p "$OUTPUT_DIR"

video_base_filter() {
  local label="$1"
  if [ "$STYLE" = "full" ]; then
    printf "%s" "${label}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1"
    return
  fi

  printf "%s" "${label}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
}

resolve_drive_output_dir() {
  if [ -n "$DRIVE_OUTPUT_DIR" ]; then
    printf "%s" "$DRIVE_OUTPUT_DIR"
    return 0
  fi

  local drive_root=""
  drive_root="$(
    find "$HOME/Library/CloudStorage" -maxdepth 1 -type d -name 'GoogleDrive*' -print -quit 2>/dev/null || true
  )"

  if [ -z "$drive_root" ]; then
    return 1
  fi

  if [ -d "$drive_root/My Drive" ]; then
    printf "%s/%s" "$drive_root/My Drive" "$DRIVE_FOLDER_NAME"
  elif [ -d "$drive_root/Mi unidad" ]; then
    printf "%s/%s" "$drive_root/Mi unidad" "$DRIVE_FOLDER_NAME"
  else
    printf "%s/%s" "$drive_root" "$DRIVE_FOLDER_NAME"
  fi
}

copy_to_drive_folder() {
  local file="$1"
  local drive_dir

  if ! drive_dir="$(resolve_drive_output_dir)"; then
    echo "Google Drive Desktop no esta montado. No pude copiar a Drive todavia."
    echo "Cuando Google Drive aparezca en Finder, vuelves a correr: FORCE=1 scripts/edit-radio-videos.sh"
    return 0
  fi

  mkdir -p "$drive_dir"
  cp -p "$file" "$drive_dir/"
  echo "Copiado a Google Drive: $drive_dir/$(basename "$file")"
}

videos=()

while IFS= read -r -d '' video; do
  videos+=("$video")
done < <(
  find "$SOURCE_DIR" -maxdepth "$SEARCH_DEPTH" \
    \( -type d \( -name 'CapCut' -o -name 'JianyingPro' -o -iname '*cache*' \) -prune \) -o \
    \( -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' \) ! -name '._*' -print0 \) \
    2>/dev/null
)

if [ "${#videos[@]}" -eq 0 ]; then
  while IFS= read -r -d '' video; do
    videos+=("$video")
  done < <(
    find "$FALLBACK_INPUT_DIR" -maxdepth 1 -type f \
      \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' \) \
      ! -name '._*' \
      -print0 2>/dev/null
  )
fi

if [ "${#videos[@]}" -eq 0 ]; then
  echo "No encontre videos en: $SOURCE_DIR"
  echo "Tampoco encontre videos en: $FALLBACK_INPUT_DIR"
  echo "Agrega .mp4, .mov o .m4v y vuelve a correr este script."
  exit 0
fi

for input in "${videos[@]}"; do
  base="$(basename "$input")"
  name="${base%.*}"
  output="$OUTPUT_DIR/${name}_30s_reel.mp4"

  if [ "$FORCE" != "1" ] && [ -f "$output" ]; then
    echo "Ya existe, saltando: $output"
    echo "Usa FORCE=1 scripts/edit-radio-videos.sh para regenerarlo."
    copy_to_drive_folder "$output"
    continue
  fi

  duration="$(
    ffprobe -v error \
      -show_entries format=duration \
      -of default=noprint_wrappers=1:nokey=1 \
      "$input"
  )"

  has_audio="$(
    ffprobe -v error \
      -select_streams a:0 \
      -show_entries stream=index \
      -of csv=p=0 \
      "$input" | head -n 1
  )"

  if [ "$CUTS" -gt 1 ]; then
    output_seconds="$(awk "BEGIN { if ($duration > $TARGET_SECONDS) printf \"%.6f\", $TARGET_SECONDS; else printf \"%.6f\", $duration * $SHORT_OUTPUT_RATIO }")"
    segment_len="$(awk "BEGIN { printf \"%.6f\", $output_seconds / $CUTS }")"
    max_start="$(awk "BEGIN { printf \"%.6f\", $duration - $segment_len }")"
    filter=""
    concat_inputs=""

    for ((i = 0; i < CUTS; i++)); do
      if [ "$CUTS" -eq 1 ]; then
        start="0"
      else
        start="$(awk "BEGIN { printf \"%.6f\", ($max_start * $i) / ($CUTS - 1) }")"
      fi
      end="$(awk "BEGIN { printf \"%.6f\", $start + $segment_len }")"

      filter+="$(video_base_filter "[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,")[v${i}];"
      concat_inputs+="[v${i}]"

      if [ -n "$has_audio" ]; then
        filter+="[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}];"
        concat_inputs+="[a${i}]"
      fi
    done

    if [ -n "$has_audio" ]; then
      filter+="${concat_inputs}concat=n=${CUTS}:v=1:a=1[v][a]"
      map_args=(-map "[v]" -map "[a]")
    else
      filter+="${concat_inputs}concat=n=${CUTS}:v=1:a=0[v]"
      map_args=(-map "[v]")
    fi

    ffmpeg -y -i "$input" \
      -filter_complex "$filter" \
      "${map_args[@]}" \
      -t "$output_seconds" \
      -c:v libx264 -preset medium -crf 18 \
      -pix_fmt yuv420p \
      -c:a aac -b:a 192k \
      -movflags +faststart \
      "$output"
  else
    ffmpeg -y -i "$input" \
      -filter_complex "$(video_base_filter "[0:v]")[v]" \
      -map "[v]" -map 0:a? \
      -t "$TARGET_SECONDS" \
      -c:v libx264 -preset medium -crf 18 \
      -pix_fmt yuv420p \
      -c:a aac -b:a 192k \
      -movflags +faststart \
      "$output"
  fi

  echo "Listo: $output"
  copy_to_drive_folder "$output"
done
