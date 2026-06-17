#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_DIR="$ROOT_DIR/promo_video_edits/01_originales"
OUTPUT_DIR="$ROOT_DIR/promo_video_edits/03_listos_para_subir"

OBJECTIVE="${OBJECTIVE:-nightlife}"
CLIPS_PER_VIDEO="${CLIPS_PER_VIDEO:-5}"
TARGET_SECONDS="${TARGET_SECONDS:-15}"
CUTS="${CUTS:-3}"
WIDTH="${WIDTH:-1080}"
HEIGHT="${HEIGHT:-1920}"
STYLE="${STYLE:-full}"
HOOK_TEXT="${HOOK_TEXT:-BEST APP TO GO OUT}"
CTA_TEXT="${CTA_TEXT:-JOIN THE GUESTLIST}"

mkdir -p "$INPUT_DIR" "$OUTPUT_DIR"

escape_drawtext() {
  printf "%s" "$1" | sed "s/'/ /g; s/:/ /g; s/%/ percent/g; s/\\\\/ /g"
}

video_base_filter() {
  local label="$1"
  if [ "$STYLE" = "post" ]; then
    printf "%s" "${label}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    return
  fi

  printf "%s" "${label}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1"
}

text_filter() {
  local hook
  local cta
  hook="$(escape_drawtext "$HOOK_TEXT")"
  cta="$(escape_drawtext "$CTA_TEXT")"

  printf "%s" "drawtext=text='${hook}':x=(w-text_w)/2:y=150:fontcolor=white:fontsize=72:font='Arial Bold':box=1:boxcolor=black@0.62:boxborderw=28,drawtext=text='${cta}':x=(w-text_w)/2:y=h-250:fontcolor=white:fontsize=54:font='Arial Bold':box=1:boxcolor=black@0.62:boxborderw=22"
}

shopt -s nullglob
videos=("$INPUT_DIR"/*.mp4 "$INPUT_DIR"/*.mov "$INPUT_DIR"/*.m4v)

if [ "${#videos[@]}" -eq 0 ]; then
  echo "No encontre videos en: $INPUT_DIR"
  echo "Agrega .mp4, .mov o .m4v y vuelve a correr el Promo Video Agent."
  exit 0
fi

for input in "${videos[@]}"; do
  base="$(basename "$input")"
  name="${base%.*}"

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

  if awk "BEGIN { exit !($duration > 0) }"; then
    true
  else
    echo "Duracion invalida, salto: $input"
    continue
  fi

  for ((clip = 1; clip <= CLIPS_PER_VIDEO; clip++)); do
    safe_objective="$(printf "%s" "$OBJECTIVE" | tr -cd '[:alnum:]_-')"
    output="$OUTPUT_DIR/${name}_${safe_objective}_clip$(printf "%02d" "$clip")_${TARGET_SECONDS}s.mp4"

    if awk "BEGIN { exit !($duration > $TARGET_SECONDS) }"; then
      max_start="$(awk "BEGIN { printf \"%.6f\", $duration - $TARGET_SECONDS }")"
      if [ "$CLIPS_PER_VIDEO" -eq 1 ]; then
        start="0"
      else
        start="$(awk "BEGIN { printf \"%.6f\", ($max_start * ($clip - 1)) / ($CLIPS_PER_VIDEO - 1) }")"
      fi
    else
      start="0"
    fi

    if awk "BEGIN { exit !($CUTS > 1 && $duration > $TARGET_SECONDS) }"; then
      segment_len="$(awk "BEGIN { printf \"%.6f\", $TARGET_SECONDS / $CUTS }")"
      filter=""
      concat_inputs=""

      for ((i = 0; i < CUTS; i++)); do
        segment_start="$(awk "BEGIN { printf \"%.6f\", $start + ($segment_len * $i) }")"
        segment_end="$(awk "BEGIN { printf \"%.6f\", $segment_start + $segment_len }")"

        filter+="$(video_base_filter "[0:v]trim=start=${segment_start}:end=${segment_end},setpts=PTS-STARTPTS,")[v${i}];"
        concat_inputs+="[v${i}]"

        if [ -n "$has_audio" ]; then
          filter+="[0:a]atrim=start=${segment_start}:end=${segment_end},asetpts=PTS-STARTPTS[a${i}];"
          concat_inputs+="[a${i}]"
        fi
      done

      if [ -n "$has_audio" ]; then
        filter+="${concat_inputs}concat=n=${CUTS}:v=1:a=1[vraw][a];[vraw]${text_filter}[v]"
        map_args=(-map "[v]" -map "[a]")
      else
        filter+="${concat_inputs}concat=n=${CUTS}:v=1:a=0,${text_filter}[v]"
        map_args=(-map "[v]")
      fi

      ffmpeg -y -i "$input" \
        -filter_complex "$filter" \
        "${map_args[@]}" \
        -t "$TARGET_SECONDS" \
        -c:v libx264 -preset medium -crf 18 \
        -pix_fmt yuv420p \
        -c:a aac -b:a 192k \
        -movflags +faststart \
        "$output"
    else
      ffmpeg -y -ss "$start" -i "$input" \
        -filter_complex "$(video_base_filter "[0:v]"),$(text_filter)[v]" \
        -map "[v]" -map 0:a? \
        -t "$TARGET_SECONDS" \
        -c:v libx264 -preset medium -crf 18 \
        -pix_fmt yuv420p \
        -c:a aac -b:a 192k \
        -movflags +faststart \
        "$output"
    fi

    echo "Listo: $output"
  done
done
