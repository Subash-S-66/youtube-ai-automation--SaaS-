from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from youtube_ai_automation.run_local import main


if __name__ == "__main__":
    main()
