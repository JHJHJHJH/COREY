import type CameraControls from "camera-controls";
import { Vector3 } from "three";

/** Link the rendered camera states while letting either pane drive navigation. */
export function synchronizeCompareCameras(
  base: CameraControls,
  target: CameraControls,
): () => void {
  let source = base;
  let synchronizing = false;
  let disposed = false;
  const position = new Vector3();
  const lookTarget = new Vector3();
  const focalOffset = new Vector3();
  const sourceEvents = ["controlstart", "control", "transitionstart"] as const;

  const synchronize = () => {
    if (synchronizing || disposed) {
      return;
    }

    const follower = source === base ? target : base;
    // The default getters return the transition destination, which would make
    // the follower jump ahead of the source's smoothly animated camera.
    source.getPosition(position, false);
    source.getTarget(lookTarget, false);
    source.getFocalOffset(focalOffset, false);

    synchronizing = true;
    try {
      void follower.setLookAt(
        position.x,
        position.y,
        position.z,
        lookTarget.x,
        lookTarget.y,
        lookTarget.z,
        false,
      );
      void follower.setFocalOffset(focalOffset.x, focalOffset.y, focalOffset.z, false);
      void follower.zoomTo(source.camera.zoom, false);
      // Update the rendered camera immediately, then let the follower's own
      // loop tick its controls. Calling follower.update() inside a source
      // update would overwrite camera-controls' shared damping scratch vectors.
      follower.camera.position.copy(source.camera.position);
      follower.camera.quaternion.copy(source.camera.quaternion);
      follower.camera.zoom = source.camera.zoom;
      follower.camera.updateProjectionMatrix();
      follower.camera.updateMatrixWorld();
    } finally {
      synchronizing = false;
    }
  };

  const unlinkers = [base, target].map((controls) => {
    const takeControl = () => {
      if (!synchronizing && !disposed) {
        source = controls;
      }
    };
    const handleUpdate = () => {
      if (controls === source) {
        synchronize();
      }
    };

    // Wheel events emit `control` without `controlstart`. Programmatic focus
    // and reset emit `transitionstart`. Ownership lasts through damping; a
    // follower's delayed update alone can never make it the source.
    for (const event of sourceEvents) {
      controls.addEventListener(event, takeControl);
    }
    controls.addEventListener("update", handleUpdate);
    // The last damping tick can snap to the destination and emit only sleep.
    controls.addEventListener("sleep", handleUpdate);

    return () => {
      for (const event of sourceEvents) {
        controls.removeEventListener(event, takeControl);
      }
      controls.removeEventListener("update", handleUpdate);
      controls.removeEventListener("sleep", handleUpdate);
    };
  });

  synchronize();

  return () => {
    disposed = true;
    for (const unlink of unlinkers) {
      unlink();
    }
  };
}
