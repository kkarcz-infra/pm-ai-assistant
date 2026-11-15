#!/usr/bin/env bash
set -euo pipefail

SSH_KEY="${GCP_SSH_KEY:-$HOME/.ssh/ssh_key}"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
START_TIMEOUT="${GCP_START_TIMEOUT:-300}"
STOP_TIMEOUT="${GCP_STOP_TIMEOUT:-300}"

if [[ "$PROJECT" == "(unset)" ]]; then
  PROJECT=""
fi

usage() {
  cat <<'EOF'
gcp-ssh.sh - logowanie SSH do VM-ek w Google Cloud oraz uruchamianie i zatrzymywanie ich.

Użycie: gcp-ssh.sh [opcje] [nazwa-vm] [dodatkowe-argumenty gcloud compute ssh...]

Opcje:
  -h, --help   pokaż tę pomoc
  -l, --list   wylistuj dostępne VM-ki (nazwa, strefa, status)
  -r, --start  uruchom wybraną VM
  -s, --stop   zatrzymaj wybraną VM

Bez nazwy VM (ale z opcją, np. --stop) skrypt pokaże interaktywną listę
instancji do wyboru. Logowanie wymaga uruchomionej VM - jeśli jest wyłączona,
uruchom ją przez --start. Bez żadnych parametrów wyświetlana jest ta pomoc.

Przykłady:
  gcp-ssh.sh
  gcp-ssh.sh --list
  gcp-ssh.sh ssh-vm
  gcp-ssh.sh ssh-vm --command "uptime"
  gcp-ssh.sh --command "uptime"
  gcp-ssh.sh ssh-vm --start
  gcp-ssh.sh --stop
  gcp-ssh.sh ssh-vm --stop
EOF
}

if [[ $# -eq 0 ]]; then
  usage
  exit 0
fi

START_MODE=0
STOP_MODE=0
LIST_MODE=0
SHOW_HELP=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    -h|--help) SHOW_HELP=1 ;;
    -l|--list) LIST_MODE=1 ;;
    -r|--start) START_MODE=1 ;;
    -s|--stop) STOP_MODE=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [[ "$SHOW_HELP" -eq 1 ]]; then
  usage
  exit 0
fi

if (( START_MODE + STOP_MODE + LIST_MODE > 1 )); then
  echo "Błąd: opcje --start, --stop i --list nie mogą być łączone." >&2
  exit 1
fi

if [[ ${#ARGS[@]} -gt 0 ]]; then
  set -- "${ARGS[@]}"
else
  set --
fi

if [[ "$START_MODE" -eq 0 && "$STOP_MODE" -eq 0 && "$LIST_MODE" -eq 0 ]]; then
  if [[ ! -f "$SSH_KEY" ]]; then
    echo "Błąd: nie znaleziono klucza SSH: $SSH_KEY" >&2
    echo "Ustaw inną ścieżkę przez zmienną GCP_SSH_KEY." >&2
    exit 1
  fi

  key_perms=$(stat -f '%Lp' "$SSH_KEY" 2>/dev/null || stat -c '%a' "$SSH_KEY" 2>/dev/null || echo "")
  if [[ -n "$key_perms" && "$key_perms" != "600" && "$key_perms" != "400" ]]; then
    chmod 600 "$SSH_KEY"
    echo "Ustawiono uprawnienia 600 dla $SSH_KEY"
  fi
fi

list_args=(compute instances list --format="value(name,zone,status)")
if [[ -n "$PROJECT" ]]; then
  list_args+=(--project="$PROJECT")
fi

if ! instances_output=$(gcloud "${list_args[@]}"); then
  echo "Błąd: nie udało się pobrać listy instancji GCP." >&2
  echo "Sprawdź logowanie (gcloud auth login) i aktywny projekt." >&2
  exit 1
fi

VM_NAMES=()
VM_ZONES=()
VM_STATUSES=()

while IFS=$'\t' read -r name zone status; do
  [[ -z "$name" ]] && continue
  VM_NAMES+=("$name")
  VM_ZONES+=("$zone")
  VM_STATUSES+=("$status")
done <<< "$instances_output"

if [[ ${#VM_NAMES[@]} -eq 0 ]]; then
  if [[ "$LIST_MODE" -eq 1 ]]; then
    echo "Brak instancji VM w projekcie ${PROJECT:-<aktywny>}."
    exit 0
  fi
  echo "Błąd: brak instancji VM w projekcie ${PROJECT:-<aktywny>}." >&2
  exit 1
fi

if [[ "$LIST_MODE" -eq 1 ]]; then
  if [[ $# -gt 0 ]]; then
    echo "Błąd: tryb --list nie przyjmuje dodatkowych argumentów." >&2
    echo "Użycie: gcp-ssh.sh [--list]" >&2
    exit 1
  fi
  printf '%-24s %-18s %s\n' "NAZWA" "STREFA" "STATUS"
  for i in "${!VM_NAMES[@]}"; do
    printf '%-24s %-18s %s\n' "${VM_NAMES[$i]}" "${VM_ZONES[$i]}" "${VM_STATUSES[$i]}"
  done
  exit 0
fi

choose_vm() {
  local i
  echo "Dostępne VM-ki:"
  for i in "${!VM_NAMES[@]}"; do
    printf '  %d) %s (%s) [%s]\n' "$((i + 1))" "${VM_NAMES[$i]}" "${VM_ZONES[$i]}" "${VM_STATUSES[$i]}"
  done

  local selection
  while true; do
    read -r -p "Wybierz numer VM-ki: " selection || { echo >&2; exit 1; }
    if [[ "$selection" =~ ^[0-9]+$ ]] && (( selection >= 1 && selection <= ${#VM_NAMES[@]} )); then
      CHOSEN_INDEX=$((selection - 1))
      return 0
    fi
    echo "Nieprawidłowy wybór, podaj liczbę od 1 do ${#VM_NAMES[@]}." >&2
  done
}

if [[ $# -eq 0 || "${1:-}" == -* ]]; then
  choose_vm
  shift_args=("$@")
else
  requested="$1"
  shift_args=("${@:2}")

  MATCH_NAMES=()
  MATCH_ZONES=()
  MATCH_STATUSES=()
  for i in "${!VM_NAMES[@]}"; do
    if [[ "${VM_NAMES[$i]}" == "$requested" ]]; then
      MATCH_NAMES+=("${VM_NAMES[$i]}")
      MATCH_ZONES+=("${VM_ZONES[$i]}")
      MATCH_STATUSES+=("${VM_STATUSES[$i]}")
    fi
  done

  if [[ ${#MATCH_NAMES[@]} -eq 0 ]]; then
    echo "Błąd: nie znaleziono VM o nazwie '$requested'." >&2
    echo "Dostępne VM-ki:" >&2
    for i in "${!VM_NAMES[@]}"; do
      printf '  - %s (%s) [%s]\n' "${VM_NAMES[$i]}" "${VM_ZONES[$i]}" "${VM_STATUSES[$i]}" >&2
    done
    exit 1
  fi

  VM_NAMES=("${MATCH_NAMES[@]}")
  VM_ZONES=("${MATCH_ZONES[@]}")
  VM_STATUSES=("${MATCH_STATUSES[@]}")

  if [[ ${#VM_NAMES[@]} -eq 1 ]]; then
    CHOSEN_INDEX=0
  else
    echo "Nazwa '$requested' istnieje w kilku strefach." >&2
    choose_vm
  fi
fi

VM_NAME="${VM_NAMES[$CHOSEN_INDEX]}"
VM_ZONE="${VM_ZONES[$CHOSEN_INDEX]}"
VM_STATUS="${VM_STATUSES[$CHOSEN_INDEX]}"

start_args=(compute instances start "$VM_NAME" --zone="$VM_ZONE")
stop_args=(compute instances stop "$VM_NAME" --zone="$VM_ZONE")
describe_args=(compute instances describe "$VM_NAME" --zone="$VM_ZONE" --format="value(status)")
if [[ -n "$PROJECT" ]]; then
  start_args+=(--project="$PROJECT")
  stop_args+=(--project="$PROJECT")
  describe_args+=(--project="$PROJECT")
fi

start_vm() {
  local status="$1"

  if [[ "$status" == "RUNNING" ]]; then
    echo "VM ${VM_NAME} jest już uruchomiona."
    return 0
  fi

  if [[ "$status" == "SUSPENDED" ]]; then
    echo "Błąd: VM ${VM_NAME} jest zawieszona (SUSPENDED)." >&2
    echo "Wznów ją: gcloud compute instances resume ${VM_NAME} --zone=${VM_ZONE}" >&2
    exit 1
  fi

  echo "Uruchamianie VM ${VM_NAME} (${VM_ZONE})..."
  gcloud "${start_args[@]}" >/dev/null

  local deadline=$(( SECONDS + START_TIMEOUT ))
  while (( SECONDS < deadline )); do
    status=$(gcloud "${describe_args[@]}" 2>/dev/null || true)
    if [[ "$status" == "RUNNING" ]]; then
      echo "VM ${VM_NAME} została uruchomiona."
      return 0
    fi
    sleep 5
  done

  echo "Błąd: VM ${VM_NAME} nie osiągnęła stanu RUNNING w ${START_TIMEOUT}s (ostatni stan: ${status:-nieznany})." >&2
  exit 1
}

require_running() {
  local status="$1"

  if [[ "$status" == "RUNNING" ]]; then
    return 0
  fi

  if [[ "$status" == "SUSPENDED" ]]; then
    echo "Błąd: VM ${VM_NAME} jest zawieszona (SUSPENDED)." >&2
    echo "Wznów ją: gcloud compute instances resume ${VM_NAME} --zone=${VM_ZONE}" >&2
    exit 1
  fi

  echo "Błąd: VM ${VM_NAME} nie jest uruchomiona (stan: ${status})." >&2
  echo "Uruchom ją: gcp-ssh.sh ${VM_NAME} --start" >&2
  exit 1
}

stop_vm() {
  local status="$1"

  if [[ "$status" == "TERMINATED" ]]; then
    echo "VM ${VM_NAME} jest już wyłączona."
    return 0
  fi

  if [[ "$status" == "SUSPENDED" ]]; then
    echo "Błąd: VM ${VM_NAME} jest zawieszona (SUSPENDED), nie można jej zatrzymać." >&2
    echo "Wznów ją: gcloud compute instances resume ${VM_NAME} --zone=${VM_ZONE}" >&2
    exit 1
  fi

  echo "Zatrzymywanie VM ${VM_NAME} (${VM_ZONE})..."
  gcloud "${stop_args[@]}" >/dev/null

  local deadline=$(( SECONDS + STOP_TIMEOUT ))
  while (( SECONDS < deadline )); do
    status=$(gcloud "${describe_args[@]}" 2>/dev/null || true)
    if [[ "$status" == "TERMINATED" ]]; then
      echo "VM ${VM_NAME} została zatrzymana."
      return 0
    fi
    sleep 5
  done

  echo "Błąd: VM ${VM_NAME} nie osiągnęła stanu TERMINATED w ${STOP_TIMEOUT}s (ostatni stan: ${status:-nieznany})." >&2
  exit 1
}

if [[ "$START_MODE" -eq 1 ]]; then
  if [[ ${#shift_args[@]} -gt 0 ]]; then
    echo "Błąd: tryb --start nie przyjmuje dodatkowych argumentów." >&2
    echo "Użycie: gcp-ssh.sh [nazwa-vm] --start" >&2
    exit 1
  fi
  start_vm "$VM_STATUS"
  exit 0
fi

if [[ "$STOP_MODE" -eq 1 ]]; then
  if [[ ${#shift_args[@]} -gt 0 ]]; then
    echo "Błąd: tryb --stop nie przyjmuje dodatkowych argumentów." >&2
    echo "Użycie: gcp-ssh.sh [nazwa-vm] --stop" >&2
    exit 1
  fi
  stop_vm "$VM_STATUS"
  exit 0
fi

require_running "$VM_STATUS"

echo "Łączenie z ${VM_NAME} (${VM_ZONE})..."

ssh_args=(compute ssh "$VM_NAME" --zone="$VM_ZONE" --ssh-key-file="$SSH_KEY")
if [[ -n "$PROJECT" ]]; then
  ssh_args+=(--project="$PROJECT")
fi

if [[ ${#shift_args[@]} -eq 0 ]]; then
  exec gcloud "${ssh_args[@]}"
else
  exec gcloud "${ssh_args[@]}" "${shift_args[@]}"
fi
