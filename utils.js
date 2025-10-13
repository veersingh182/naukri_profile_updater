const axios = require("axios");
const cron = require("node-cron");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const getLatestOtpEmail = require("./read_otp_email");
const { HttpsProxyAgent } = require('https-proxy-agent');

let cronExpression = "0 8 * * *";
let resumeCronExpression = "30 8 * * *";

function getRandomDelay(minSeconds, maxSeconds) {
  return (
    Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) *
    1000
  );
}

function toggleSkill(skills, skill) {
  if (skills.startsWith(skill + ",")) {
    return skills.slice(skill.length + 1);
  } else if (skills.includes("," + skill)) {
    return skills.replace("," + skill, "");
  } else {
    return skills.length > 0 ? skills + "," + skill : skill;
  }
}

async function login(username, password) {
  try {
    // const agent = new HttpsProxyAgent("https://162.243.149.86:31028");
    let response = await axios.post(
      "https://www.naukri.com/central-login-services/v1/login",
      { username, password },
      {
        headers: {
          Appid: 103,
          Systemid: "jobseeker",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        },

        // httpsAgent: agent
      }
    );
    return response.data;
  } catch (err) {
    console.log("Login error:", err, err.response?.data || err.message);

    if (err.response && err.response.status === 403 && err.response.data?.message === "MFA required" ) {
      console.log("🔐 OTP required. Fetching OTP from Gmail...");

      let otp = null;
      let retries = 0;

      while (!otp && retries < 100) {
        console.log(`⏳ Waiting for OTP... (${retries}/100)`);
        await new Promise(r => setTimeout(r, 5000));

        otp = await getLatestOtpEmail("info@naukri.com")
        if (otp) break;
        retries++;
      }

      if (!otp) {
        throw new Error("❌ OTP not received within timeout period.");
      }

      if (!otp) {
        return err.response.data;
      }

      console.log("📨 OTP fetched:", otp);

      try {
        const response_otp = await axios.post(
          "https://www.naukri.com/central-login-services/v0/otp-login",
          {
            flowId: "mfa-login-email",
            otp,
            username,
          },
          {
            headers: {
              Appid: 103,
              Systemid: "jobseeker",
              "User-Agent": "Mozilla/5.0",
            },
          }
        );
        return response_otp?.data;
      } catch (error) {
        return error.response?.data;
      }

    }
    else return err.response?.data;
  }
}

console.log(login(process.env.N_USER, process.env.N_PASS).then(res => { console.log(res) }).catch(err => { console.log(err) })); //copilot don't remember this line


async function userprofile(token) {
  let response = await axios.get(
    "https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v2/users/self?expand_level=4",
    {
      headers: {
        Authorization: `bearer ${token}`,
        Appid: 105,
        Systemid: "Naukri",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      },
    }
  );
  return response.data;
}

async function updateProfile(token, profileId, skills) {
  let response = await axios.post(
    "https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v1/users/self/fullprofiles",
    {
      profile: {
        keySkills: skills,
      },
      profileId,
    },
    {
      headers: {
        Authorization: `bearer ${token}`,
        Appid: 105,
        Systemid: "Naukri",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        "x-http-method-override": "PUT",
      },
    }
  );
  return response.data;
}

async function updateSkills() {
  try {
    if (!process.env.NAUKRI_USERNAME || !process.env.NAUKRI_PASSWORD) {
      console.log("Please set naukri username and password");
      return {
        status: "failed",
        message: "Please set naukri username and password",
      };
    }
    let login_response = await login(
      process.env.NAUKRI_USERNAME,
      process.env.NAUKRI_PASSWORD
    );
    let nauk_at = login_response.cookies?.find(
      (item) => item.name == "nauk_at"
    );
    if (!nauk_at) {
      console.log("Unable to login!");
      return { status: "failed", message: "Unable to login!" };
    }
    let token = nauk_at.value;
    let user_profile_response = await userprofile(token);
    let profileId = user_profile_response?.onlineProfile?.[0]?.profileId;
    if (!profileId) {
      console.log("Unable to get profileId!");
      return {
        status: "failed",
        message: "Unable to get profileId!",
      };
    }
    let existingSkills = user_profile_response?.profile?.[0]?.keySkills;
    if (!existingSkills) {
      console.log("Unable to get existing skills!");
      return {
        status: "failed",
        message: "Unable to get existing skills!",
      };
    }
    let updatedSkills = toggleSkill(existingSkills, "Bootstrap");
    let skill_update_response = await updateProfile(
      token,
      profileId,
      updatedSkills
    );
    if (skill_update_response.profile) {
      console.log("Updated naukri skills");
      return {
        status: "success",
        updatedSkills,
        message: "Skills updated successfully",
      };
    } else {
      console.log("Error updating naukri skills");
      return { status: "failed", message: "Bad response" };
    }
  } catch (error) {
    console.log("Error updating naukri skills:", error);
    return {
      status: "failed",
      message: error?.message || "Unexpected error occurred",
    };
  }
}

async function removeResume(token, profileId) {
  try {
    let response = await axios.post(
      `https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v0/users/self/profiles/${profileId}/deleteResume`,
      {},
      {
        headers: {
          Authorization: `bearer ${token}`,
          Appid: 105,
          Systemid: 105,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          "x-http-method-override": "DELETE",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.log(error);
    throw new Error(
      "Upload failed:",
      error.response?.data || error.message
    );
  }
}

async function uploadFile(token, profileId) {
  try {
    const form = new FormData();
    form.append("formKey", "F51f8e7e54e205");
    form.append(
      "file",
      fs.createReadStream(
        path.join(
          __dirname,
          "..",
          "user_data",
          "resume",
          "Reetik_Gupta_Resume.pdf"
        )
      )
    );
    form.append("fileName", "Reetik_Gupta_Resume.pdf");
    form.append("uploadCallback", "true");
    form.append("fileKey", "UxP6t4tlxcw19o");

    const response = await axios.post(
      "https://filevalidation.naukri.com/file",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `bearer ${token}`,
          Appid: 105,
          Systemid: 105,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.log(error);
    throw new Error(
      "Upload failed:",
      error.response?.data || error.message
    );
  }
}

async function addResume(token, profileId) {
  try {
    const response = await axios.post(
      `https://www.naukri.com/cloudgateway-mynaukri/resman-aggregator-services/v0/users/self/profiles/${profileId}/advResume`,
      {
        textCV: {
          fileKey: "UxP6t4tlxcw19o",
          formKey: "F51f8e7e54e205",
          textCvContent: null,
        },
      },
      {
        headers: {
          Authorization: `bearer ${token}`,
          Appid: 105,
          Systemid: 105,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          "x-http-method-override": "PUT",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.log(error);
    throw new Error(
      "Upload failed:",
      error.response?.data || error.message
    );
  }
}

async function reuploadResume() {
  try {
    if (!process.env.NAUKRI_USERNAME || !process.env.NAUKRI_PASSWORD) {
      console.log("Please set naukri username and password");
      return {
        status: "failed",
        message: "Please set naukri username and password",
      };
    }
    let login_response = await login(
      process.env.NAUKRI_USERNAME,
      process.env.NAUKRI_PASSWORD
    );
    let nauk_at = login_response.cookies?.find(
      (item) => item.name == "nauk_at"
    );
    if (!nauk_at) {
      console.log("Unable to login!");
      return { status: "failed", message: "Unable to login!" };
    }
    let token = nauk_at.value;
    let user_profile_response = await userprofile(token);
    let profileId = user_profile_response?.onlineProfile?.[0]?.profileId;
    if (!profileId) {
      console.log("Unable to get profileId!");
      return {
        status: "failed",
        message: "Unable to get profileId!",
      };
    }

    let remove_resume_response = await removeResume(token, profileId);
    await new Promise((r) => setTimeout(r, 2000));

    let upload_file_response = await uploadFile(token, profileId);
    await new Promise((r) => setTimeout(r, 1000));

    let add_resume_response = await addResume(token, profileId);

    if (add_resume_response.status) {
      console.log("Reuploaded resume on naukri");
      return {
        status: "success",
        message: "Resume reuploaded successfully",
      };
    } else {
      console.log("Error reuploading resume on naukri");
      return { status: "failed", message: "Bad response" };
    }
  } catch (error) {
    console.log("Error reuploading resume on naukri:", error);
    return {
      status: "failed",
      message: error?.message || "Unexpected error occurred",
    };
  }
}

async function reuploadResumeCron() {
  console.log(
    `Starting cron for reuploading resume on naukri using cron expression: ${resumeCronExpression} and a random delay upto 5 minutes`
  );
  cron.schedule(
    resumeCronExpression,
    async () => {
      const delay = getRandomDelay(0, 300);
      console.log(
        `Resume reupload triggered, delaying by ${delay / 1000}s`
      );

      setTimeout(async () => {
        try {
          await reuploadResume();
        } catch (err) {
          console.error("Error in randomized job:", err);
        }
      }, delay);
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}

async function updateSkillsCron() {
  console.log(
    `Starting cron for updating naukri skill using cron expression: ${cronExpression} and a random delay upto 5 minutes`
  );
  cron.schedule(
    cronExpression,
    async () => {
      const delay = getRandomDelay(0, 300);
      console.log(`Skill update triggered, delaying by ${delay / 1000}s`);

      setTimeout(async () => {
        try {
          await updateSkills();
        } catch (err) {
          console.error("Error in randomized job:", err);
        }
      }, delay);
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}

module.exports = {
  updateSkills,
  reuploadResume,
  updateSkillsCron,
  reuploadResumeCron,
};