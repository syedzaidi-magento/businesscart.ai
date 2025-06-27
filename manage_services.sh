#!/bin/bash

# Define service configurations
declare -A services
services["UserService"]="3000"
services["CompanyService"]="3001"
services["ProductService"]="3002"
srvices["OrderService"]="3003"
services["CartService"]="3004"

PID_FILE="sam_pids.txt"

# Function to run a command in a new GNOME Terminal tab
run_in_new_tab() {
  local cmd="$1"
  gnome-terminal --tab --command="bash -c \"$cmd; exec bash\"" &
}

start_services() {
  echo "Synthesizing CDK templates..."
  npm run cdk synth || { echo "CDK synth failed. Exiting."; exit 1; }
  echo "CDK templates synthesized successfully."

  echo "Starting microservices in new terminal tabs..."
  # Ensure the PID file is empty before starting
  > "$PID_FILE"

  for service_name in "${!services[@]}"; do
    port="${services[$service_name]}"
    template_path="cdk.out/${service_name}Stack.template.json"

    if [ ! -f "$template_path" ]; then
      echo "Error: Template file not found for $service_name at $template_path. CDK synth might have failed."
      exit 1
    fi

    echo "Preparing to start $service_name on port $port..."
    # Construct the SAM command
    sam_cmd="sam local start-api -t \"$template_path\" --docker-network host --debug --port \"$port\""

    # Run SAM in a new tab and store its PID (from the gnome-terminal process)
    # Note: Getting the PID of the actual 'sam local' process inside the new tab is complex.
    # We'll rely on 'stop_services' to kill all 'sam local' processes.
    run_in_new_tab "$sam_cmd"
    sleep 2 # Give the terminal a moment to open and start the command
  done
  echo "All services launched. Check the new terminal tabs for their output."
  echo "Use './manage_services.sh stop' to stop all services."
}

stop_services() {
  echo "Stopping microservices..."

  # Find and kill all SAM local processes
  pids=$(pgrep -f "sam local start-api")
  if [ -n "$pids" ]; then
    echo "Killing SAM local processes: $pids..."
    kill $pids
  else
    echo "No SAM local processes found."
  fi

  # Stop and remove any lingering SAM Docker containers
  echo "Stopping and removing any lingering SAM Docker containers..."
  docker ps -aq --filter "ancestor=public.ecr.aws/lambda" | xargs -r docker stop | xargs -r docker rm

  # Remove the PID file if it exists (though it's not strictly used for killing now)
  if [ -f "$PID_FILE" ]; then
    rm "$PID_FILE"
  fi

  echo "Services stopped and containers cleaned up."
}

case "$1" in
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    stop_services
    start_services
    ;;
  *)
    echo "Usage: $0 {start|stop|restart}"
    exit 1
    ;;
esac