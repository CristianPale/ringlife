import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("apply_ios_signing", HERE / "apply-ios-signing.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PBXPROJ = (HERE.parent / "ios/App/App.xcodeproj/project.pbxproj").read_text(encoding="utf-8")


APP = "com.ringlife.app"
EXT = "com.ringlife.app.notifications"


class ApplySigningTest(unittest.TestCase):
    def test_both_release_configs_change(self):
        out = module.apply(PBXPROJ, "ABCDE12345", {APP: "App Profile", EXT: "Ext Profile"})
        self.assertEqual(out.count("CODE_SIGN_STYLE = Manual;"), 2)
        self.assertEqual(out.count("PROVISIONING_PROFILE_SPECIFIER"), 2)
        self.assertIn('PROVISIONING_PROFILE_SPECIFIER = "App Profile";', out)
        self.assertIn('PROVISIONING_PROFILE_SPECIFIER = "Ext Profile";', out)
        self.assertIn("DEVELOPMENT_TEAM = ABCDE12345;", out)
        # Debug configs keep automatic signing.
        self.assertEqual(out.count("CODE_SIGN_STYLE = Automatic;"), PBXPROJ.count("CODE_SIGN_STYLE = Automatic;") - 2)

    def test_profile_goes_to_matching_target(self):
        out = module.apply(PBXPROJ, "ABCDE12345", {EXT: "Ext Profile"})
        self.assertEqual(out.count("PROVISIONING_PROFILE_SPECIFIER"), 1)
        block = out[out.index('PROVISIONING_PROFILE_SPECIFIER'):]
        self.assertIn(f"PRODUCT_BUNDLE_IDENTIFIER = {EXT};", block[: block.index("name = Release;")])

    def test_idempotent(self):
        profiles = {APP: "App Profile", EXT: "Ext Profile"}
        once = module.apply(PBXPROJ, "ABCDE12345", profiles)
        twice = module.apply(once, "ABCDE12345", profiles)
        self.assertEqual(once, twice)

    def test_missing_target_fails(self):
        with self.assertRaises(SystemExit):
            module.apply("// empty", "t", {APP: "p"})


if __name__ == "__main__":
    unittest.main()
