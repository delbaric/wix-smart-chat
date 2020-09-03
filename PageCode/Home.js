import wixData from 'wix-data';
import { currentUser } from 'wix-users';
import { subscribe } from 'wix-realtime';
import { publishOnChannel } from 'backend/realtime';
import moment from 'moment';

let state = {
	userEmail: "",
	userRecord: {},
	notificationRecord: {}
};

$w.onReady(async function () {
	try {
		await setUserState();
		sayHello();
		setIconButtonHandlers();
		$w("#button1").onClick((event) => handleNewMessage());

		// Handle Repeater's follow-buttons
		$w("#dataset1").onReady(() => {
			refreshFollowButtons();
			$w("#button2").onClick((event) => handleFollowAction(event.context));
			$w("#button3").onClick(() => refreshFollowButtons());
			$w("#iconButton2").onClick((event) => handleEditButton(event.context));
			$w("#button8").onClick((event) => handleLikeMessage(event.context));
			$w("#button6").onClick(() => handleShowAllMessages());
			$w("#button5").onClick(() => handleShowMineMessages());
		});

		// Handle Notification list 
		refreshNotifications();
		$w("#iconButton1").onClick(() => handleIconClick());
	} catch (err) {
		console.log(err);
	}
});

async function setUserState() {
	try {
		state.userEmail = await currentUser.getEmail();
		let results = await wixData.query("Users")
			.eq("email", state.userEmail)
			.find();
		if (results.items.length === 0) {
			await handleFirstAccess();
		} else {
			state.userRecord = results.items[0];
		}
		subscribeChannels();

	} catch (err) {
		console.log(err);
	}
}

async function handleFirstAccess() {
	try {
		await wixData.insert("Users", {
			"email": state.userEmail,
			"following": [],
			"followers": []
		});
		await wixData.insert("Notifications", {
			"email": state.userEmail,
			"queue": []
		});
		// Query after insert for state to hold also the _id
		let results = await wixData.query("Users")
			.eq("email", state.userEmail)
			.find();
		state.userRecord = results.items[0];
	} catch (err) {
		console.log(err);
	}
}

function subscribeChannels() {
	// Triggered with each new message posted. Shared between all users
	const messagesChannel = { name: "Messages" };
	subscribe(messagesChannel, refreshFollowButtons);

	// Unique for user X, triggered by some user Y
	// Using first-email-part (and not full address) because full address,
	// (specifically, the char @) didn't work as chanenl name     
	let myChannelName = state.userEmail.substring(0, state.userEmail.indexOf("@"));
	myChannelName = myChannelName.substring(0, state.userEmail.indexOf("."));
	const notificationsChannel = { name: myChannelName };
	console.log("myChannelName: ", myChannelName)
	subscribe(notificationsChannel, refreshNotifications);
}

async function sayHello() {
	try {
		let results = await wixData.query("Members/PrivateMembersData")
			.eq("loginEmail", state.userEmail)
			.find();
		$w("#text14").text = "Welcome, " + results.items[0].firstName;
	} catch (err) {
		console.log(err);
	}
}

async function handleShowAllMessages() {
	try {
		await $w("#dataset1").setFilter(wixData.filter());
		refreshFollowButtons();
	} catch (err) {
		console.log(err);
	}
}

async function handleShowMineMessages() {
	try {
		await $w("#dataset1").setFilter(wixData.filter()
			.eq("email", state.userEmail))
		refreshFollowButtons();
	} catch (err) {
		console.log(err);
	}
}

async function handleNewMessage() {
	let content = $w("#textBox2").value;
	$w("#textBox2").value = null;

	let toInsert = {
		"email": state.userEmail,
		"content": content,
		"submissionTime": new Date(),
		"likes": []
	};
	try {
		// contact01 = Messages 
		await wixData.insert("contact01", toInsert);
		publishOnChannel("Messages").catch(error => console.log(error));
		notifyFollowers();
	} catch (err) {
		console.log(err);
	}
}

async function notifyFollowers() {
	state.userRecord.followers.forEach((follower) => {
		notifyUser(follower, "Added a new message");
	});
}

async function notifyUser(user, action) {
	console.log("notifyUser")
	let res = await wixData.query("Notifications")
		.eq("email", user)
		.find();
	let notificationRecord = res.items[0];
	notificationRecord.queue = [{
		user: state.userEmail,
		action,
		created: new Date(),
		seen: false
	}].concat(notificationRecord.queue);

	console.log("Q= ", notificationRecord.queue)

	// Keep the queue at 10 items max
	if (notificationRecord.queue.length > 5) {
		notificationRecord.queue.pop();
	}
	await wixData.update("Notifications", notificationRecord);

	let userChannelName = user.substring(0, user.indexOf("@"));
	userChannelName = userChannelName.substring(0, user.indexOf("."));
	console.log("userChannelName ", userChannelName)
	publishOnChannel(userChannelName).catch(error => console.log(error));
}

async function handleFollowAction(context) {
	try {
		let $item = $w.at(context);
		let author = $item("#text28").text;
		let newFollowing = state.userRecord.following.filter(e => e !== author);
		let results = await wixData.query("Users")
			.eq("email", author)
			.find();
		let authorRecord = results.items[0];

		// length didn't change after filter, so I wasn't following author yet, 
		// I.E- handle Follow action: Add author to my following, and me as author's follower
		if (newFollowing.length === state.userRecord.following.length) {
			newFollowing.push(author);
			authorRecord.followers.push(state.userEmail);
		} else {
			// I was following author, but already filtered-out above. 
			// Handle Unfollow - remove me from author's followers 
			authorRecord.followers = authorRecord.followers.filter(e => e !== state.userEmail);
		}

		let toUpdate = {
			"_id": state.userRecord._id,
			"email": state.userEmail,
			"following": newFollowing,
			"followers": state.userRecord.followers
		};
		await wixData.update("Users", toUpdate);
		await wixData.update("Users", authorRecord);
		state.userRecord.following = newFollowing;
		refreshFollowButtons();
	} catch (err) {
		console.log(err);
	}
}

function handleEditButton(context) {
	let $item = $w.at(context);
	if (!$item("#text29").hidden) {
		handleEditMessage(context);
	} else {
		$item("#text29").show();
		$item("#button7").hide();
		$item("#input1").hide();
		$item("#iconButton3").hide();
	}
}

function handleEditMessage(context) {
	let $item = $w.at(context);
	let content = $item("#text29").text;
	$item("#text29").hide();
	$item("#button7").show();
	$item("#input1").value = content;
	$item("#input1").show();
	$item("#iconButton3").show();

	$w("#iconButton3").onClick(async () => {
		try {
			content = $item("#input1").value;
			let results = await wixData.query("contact01")
				.eq("_id", context.itemId)
				.find();
			let messageRecord = results.items[0];
			messageRecord = {
				...messageRecord,
				content
			};
			await wixData.update("contact01", messageRecord);
			$item("#text29").show();
			$item("#input1").hide();
			$item("#iconButton3").hide();

			publishOnChannel("Messages").catch(error => console.log(error));
		} catch (err) {
			console.log(err);
		}
	});

	$w("#button3").onClick(async () => {
		try {

			await wixData.remove("contact01", context.itemId);
			$item("#text29").show();
			$item("#input1").hide();
			$item("#iconButton3").hide();

			publishOnChannel("Messages").catch(error => console.log(error));
		} catch (err) {
			console.log(err);
		}
	});
}

async function handleLikeMessage(context) {
	try {
		let $item = $w.at(context);
		let results = await wixData.query("contact01")
			.eq("_id", context.itemId)
			.find();
		let messageRecord = results.items[0];
		let tmpLikes = messageRecord.likes.filter(e => e !== state.userEmail);
		if (tmpLikes.length === messageRecord.likes.length) {
			messageRecord.likes.push(state.userEmail);
			let author = $item("#text28").text;
			notifyUser(author, "liked your message");
			$item("#button8").style.backgroundColor = "rgba(191, 63, 63,1)";
		} else {
			messageRecord.likes = tmpLikes;
			$item("#button8").style.backgroundColor = "rgba(102, 153, 153, 0.8)";
		}
		await wixData.update("contact01", messageRecord);
	} catch (err) {
		console.log(err);
	}
}

async function handleIconClick() {
	try {
		if ($w("#repeater2").hidden) {
			$w("#repeater2").show();
			$w("#vectorImage1").hide();
			state.notificationRecord.queue = state.notificationRecord.queue.map(val => {
				return {
					...val,
					seen: true
				}
			});

			let toUpdate = {
				"_id": state.notificationRecord._id,
				"email": state.userEmail,
				"queue": state.notificationRecord.queue
			};
			await wixData.update("Notifications", toUpdate);
		} else {
			$w("#repeater2").hide();
		}
	} catch (err) {
		console.log(err);
	}
}

function checkShowMore() {
	$w("#dataset1").getTotalCount() > $w('#dataset1').getPageSize() ?
		$w("#button3").show() :
		$w("#button3").hide();
}

async function refreshFollowButtons() {
	try {
		await $w("#dataset1").refresh();
		checkShowMore();
		if ($w("#dataset1").getTotalCount() === 0) {
			$w("#text36").show();
		} else {
			$w("#text36").hide()
		}

		$w("#repeater1").forEachItem(($w, itemData) => {
			let author = $w("#text28").text;
			if (author === state.userEmail) {
				$w("#button2").hide(); // Follow button
				$w("#iconButton2").show(); // Edit button
			} else {
				$w("#iconButton2").hide();
				let filtered = state.userRecord.following.filter(e => e === author);
				filtered.length > 0 ?
					$w("#button2").label = "Unfollow" :
					$w("#button2").label = "Follow";
			}

			let liked = itemData.likes.filter(e => e === state.userEmail);
			if (liked.length > 0) {
				$w("#button8").style.backgroundColor = "rgba(191, 63, 63,1)";
			}

		});
	} catch (err) {
		console.log(err);
	}
}

async function refreshNotifications() {
	console.log("refreshNotifications")
	try {
		let results = await wixData.query("Notifications")
			.eq("email", state.userEmail)
			.find();
		let tmpNotificationRecord = results.items[0];

		// Refactor as proper data array for repeater
		tmpNotificationRecord.queue = tmpNotificationRecord.queue.map((obj, index) => {
			return {
				...obj,
				_id: index.toString()
			}
		});

		// Assign notification data to repeater
		$w("#repeater2").onItemReady(($item, itemData, index) => {
			$item("#text32").text = itemData.user;
			$item("#text31").text = itemData.action;
			$item("#text33").text = moment(itemData.created).format('DD.MM.YY, HH:mm');
		});
		$w("#repeater2").data = []; // Behaves better when initiallaizing first
		$w("#repeater2").data = tmpNotificationRecord.queue;
		state.notificationRecord = tmpNotificationRecord;

		// Notification indicator
		if (state.notificationRecord.queue.length > 0) {
			if (!state.notificationRecord.queue[0].seen) {
				$w("#vectorImage1").show();
			}
		}
	} catch (err) {
		console.log(err);
	}
}

function setIconButtonHandlers() {
	$w("#iconButton1").onMouseIn(() => handleIconMouseIn());
	$w("#iconButton1").onMouseOut(() => $w("#text35").hide());
}

function handleIconMouseIn() {
	state.notificationRecord.queue.length !== 0 ?
		$w("#text35").text = "Click here to see your notifications" :
		$w("#text35").text = "You don't have any notifications";
	$w("#text35").show()
}